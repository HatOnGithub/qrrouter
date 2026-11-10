using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using QrRouterApi.Helpers;

namespace QrRouterApi.Repositories;

// Include observations too: native stock may have moved an item into the requested warehouse.
public sealed record StateSelection(int WarehouseId, string[] ObservedCodes);

public interface IStateRepository
{
    T Read<T>(
        int entity,
        Func<JsonObject, T> read,
        bool includeHistory = true,
        StateSelection? selection = null
    );
    T Update<T>(
        int entity,
        int user,
        string action,
        JsonObject context,
        Func<JsonObject, T> update
    );
}

public sealed class StateRepository(IOptions<AppSettings> settings) : IStateRepository
{
    private readonly string directory = Path.GetFullPath(settings.Value.DataDirectory);
    private readonly ConcurrentDictionary<int, Lazy<bool>> initialized = new();
    private static readonly string[] Maps =
    [
        "items",
        "batches",
        "personal_warehouses",
        "binloc_label_settings",
    ];

    private InventoryDbContext Open(int entity)
    {
        Json.Require(entity > 0, "Invalid entity");
        var folder = Path.Combine(directory, $"entity-{entity}");
        var path = Path.Combine(folder, "state.sqlite3");
        var initialization = initialized.GetOrAdd(
            entity,
            _ => new Lazy<bool>(() =>
            {
                Directory.CreateDirectory(folder);
                if (!OperatingSystem.IsWindows())
                    File.SetUnixFileMode(
                        folder,
                        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                    );
                using (
                    var file = new FileStream(
                        path,
                        FileMode.OpenOrCreate,
                        FileAccess.ReadWrite,
                        FileShare.ReadWrite
                    )
                )
                    if (!OperatingSystem.IsWindows())
                        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                using var db = new InventoryDbContext(InventoryDbContext.OptionsFor(path));
                db.Database.OpenConnection();
                db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL");
                db.Database.ExecuteSqlRaw("PRAGMA synchronous=FULL");
                if (db.Database.GetAppliedMigrations().Except(db.Database.GetMigrations()).Any())
                    throw new InvalidDataException("Database requires a newer QR Router service");
                db.Database.Migrate();
                ImportLegacy(db, folder);
                return true;
            })
        );
        try
        {
            _ = initialization.Value;
        }
        catch
        {
            initialized.TryRemove(new KeyValuePair<int, Lazy<bool>>(entity, initialization));
            throw;
        }
        var context = new InventoryDbContext(InventoryDbContext.OptionsFor(path));
        try
        {
            context.Database.OpenConnection();
            context.Database.ExecuteSqlRaw("PRAGMA synchronous=FULL");
            return context;
        }
        catch
        {
            context.Dispose();
            throw;
        }
    }

    private static JsonObject Empty() =>
        new()
        {
            ["schema"] = 2,
            ["revision"] = 0,
            ["history"] = new JsonArray(),
            ["items"] = new JsonObject(),
            ["batches"] = new JsonObject(),
            ["personal_warehouses"] = new JsonObject(),
            ["binloc_label_settings"] = new JsonObject(),
        };

    private static void ImportLegacy(InventoryDbContext db, string folder)
    {
        // The schema migration and data import are separate, retryable steps. A failed import
        // leaves no initialized-state marker, so correcting the legacy file allows a safe retry.
        using var transaction = db.Database.BeginTransaction();
        if (!db.Records.Any(row => row.Collection == "metadata" && row.Key == "schema"))
        {
            if (db.Records.Any() || db.History.Any())
                throw new InvalidDataException(
                    "Incomplete inventory database; restore a coordinated backup"
                );
            var legacy = Path.Combine(folder, "state.json");
            if (File.Exists(legacy) && !OperatingSystem.IsWindows())
                File.SetUnixFileMode(legacy, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            var state = File.Exists(legacy)
                ? JsonNode.Parse(File.ReadAllText(legacy)) as JsonObject
                    ?? throw new InvalidDataException("Invalid inventory state")
                : Empty();
            Save(db, state);
            db.History.AddRange(
                ((JsonArray)state["history"]!).Select(entry => new AuditEntry
                {
                    Document = entry?.ToJsonString() ?? "null",
                })
            );
            db.SaveChanges();
        }
        transaction.Commit();
    }

    public static void Validate(JsonObject state)
    {
        if (state.I("schema") != 2 || state["history"] is not JsonArray)
            throw new InvalidDataException("Expected schema 2 inventory with history");
        foreach (var key in Maps)
            state.Map(key);
        foreach (var pair in state.Map("items"))
            if (
                pair.Value is not JsonObject
                || pair.Value.S("code") != pair.Key
                || !Services.Codes.Valid(pair.Key)
            )
                throw new InvalidDataException("Invalid item identity in inventory");
    }

    private static JsonObject Load(
        InventoryDbContext db,
        bool includeHistory,
        StateSelection? selection = null
    )
    {
        var state = Empty();
        var rows = db.Records.AsNoTracking();
        foreach (
            var row in rows.Where(row =>
                row.Collection == "metadata"
                || row.Collection == "batches"
                || row.Collection == "personal_warehouses"
                || row.Collection == "binloc_label_settings"
            )
        )
        {
            var target = row.Collection == "metadata" ? state : state.Map(row.Collection);
            target[row.Key] = JsonNode.Parse(row.Document);
        }
        var items = rows.Where(row => row.Collection == "items");
        if (selection is not null)
        {
            var observed = selection.ObservedCodes;
            // Separate lookups allow SQLite to use both the warehouse index and the QR primary key.
            items = items
                .Where(row => row.WarehouseId == selection.WarehouseId)
                .Union(rows.Where(row => row.Collection == "items" && observed.Contains(row.Key)));
        }
        foreach (var row in items)
            state.Map("items")[row.Key] = JsonNode.Parse(row.Document);
        if (includeHistory)
            foreach (var row in db.History.AsNoTracking().OrderBy(row => row.Id))
                ((JsonArray)state["history"]!).Add(JsonNode.Parse(row.Document));
        Validate(state);
        return state;
    }

    // Domain callbacks still operate on the schema-2 document contract. EF tracks row changes;
    // audit entries are appended without loading or rewriting accumulated history.
    private static void Save(InventoryDbContext db, JsonObject state)
    {
        Validate(state);
        var remaining = db.Records.ToDictionary(row => (row.Collection, row.Key));
        void Set(string collection, string key, JsonNode? value)
        {
            if (!remaining.Remove((collection, key), out var row))
            {
                row = new InventoryRecord { Collection = collection, Key = key };
                db.Records.Add(row);
            }
            row.Document = value?.ToJsonString() ?? "null";
        }
        foreach (var pair in state.Where(pair => pair.Key != "history"))
            if (Maps.Contains(pair.Key))
            {
                foreach (var entry in (JsonObject)pair.Value!)
                    Set(pair.Key, entry.Key, entry.Value);
            }
            else
                Set("metadata", pair.Key, pair.Value);
        db.Records.RemoveRange(remaining.Values);
    }

    public T Read<T>(
        int entity,
        Func<JsonObject, T> read,
        bool includeHistory = true,
        StateSelection? selection = null
    )
    {
        using var db = Open(entity);
        // A deferred transaction gives the multiple read queries one consistent WAL snapshot.
        using var native = (
            (Microsoft.Data.Sqlite.SqliteConnection)db.Database.GetDbConnection()
        ).BeginTransaction(deferred: true);
        using var transaction = db.Database.UseTransaction(native);
        var result = read(Load(db, includeHistory, selection));
        native.Commit();
        return result;
    }

    public T Update<T>(
        int entity,
        int user,
        string action,
        JsonObject context,
        Func<JsonObject, T> update
    )
    {
        using var db = Open(entity);
        using var transaction = db.Database.BeginTransaction();
        var state = Load(db, false);
        var result = update(state);
        state["revision"] = checked(state.I("revision") + 1);
        ((JsonArray)state["history"]!).Add(
            Json.Object(
                ("at", Json.Now),
                ("user_id", user),
                ("action", action),
                ("context", context),
                ("revision", state.I("revision"))
            )
        );
        Save(db, state);
        db.History.AddRange(
            ((JsonArray)state["history"]!).Select(entry => new AuditEntry
            {
                Document = entry?.ToJsonString() ?? "null",
            })
        );
        db.SaveChanges();
        transaction.Commit();
        return result;
    }
}
