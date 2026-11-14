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
    JsonObject History(int entity, JsonObject filters);
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

/// <summary>
/// Persist entity documents as individual records. State changes, revision advancement and
/// new audit entries commit together. See docs/code/state-and-persistence.md for the contract.
/// </summary>
public sealed class StateRepository(IOptions<AppSettings> settings) : IStateRepository
{
    /// <summary>
    /// Page public audit summaries. Non-admin scopes must cover every affected object;
    /// entries predating visibility metadata cannot satisfy that scope.
    /// </summary>
    public JsonObject History(int entity, JsonObject filters)
    {
        var page = filters.I("page", 1);
        var size = filters.I("page_size", 50);
        var query = filters.S("q").Trim();
        var action = filters.S("action");
        var code = filters.S("code");
        var user = filters.I("user_id");
        var from = filters.S("from");
        var to = filters.S("to");
        var scoped = filters["visibility"] is JsonObject;
        var visibility = filters["visibility"] as JsonObject ?? new JsonObject();
        string Scope(string key) =>
            (visibility[key] as JsonArray ?? new JsonArray()).ToJsonString();
        var visibleCodes = Scope("codes");
        var visibleWarehouses = Scope("warehouses");
        var visibleBins = Scope("bins");
        var visibleReferences = Scope("references");
        Json.Require(
            page is > 0 and <= 1000000
                && size is > 0 and <= 100
                && query.Length <= 200
                && action.Length <= 80
                && (code == "" || Services.Codes.Valid(code))
                && user >= 0,
            "Invalid history filters"
        );
        foreach (var date in new[] { from, to })
            Json.Require(
                date == ""
                    || DateTimeOffset.TryParse(
                        date,
                        System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.AssumeUniversal,
                        out _
                    ),
                "Invalid history date"
            );
        using var db = Open(entity);
        using var native = (
            (Microsoft.Data.Sqlite.SqliteConnection)db.Database.GetDbConnection()
        ).BeginTransaction(deferred: true);
        using var transaction = db.Database.UseTransaction(native);
        // EF parameterizes interpolated SQL. Visibility arrays are values, not SQL fragments;
        // the exact QR predicate remains separate from free-text searching.
        var rows = db
            .History.FromSqlInterpolated(
                $@"SELECT id, document FROM history
            WHERE ({action} = '' OR json_extract(document, '$.action') = {action}
                OR COALESCE(json_extract(document, '$.summary.operation'), json_extract(document, '$.context.kind'), json_extract(document, '$.context.result.kind'), json_extract(document, '$.context.result.action')) = {action})
              AND ({scoped} = 0 OR (
                  json_extract(document, '$.summary.visibility_version') = 1
                  AND NOT EXISTS (SELECT 1 FROM json_each(json_extract(document, '$.summary.codes')) affected
                      WHERE affected.value NOT IN (SELECT value FROM json_each({visibleCodes})))
                  AND (COALESCE(json_extract(document, '$.summary.warehouse_id'), 0) = 0 OR json_extract(document, '$.summary.warehouse_id') IN (SELECT value FROM json_each({visibleWarehouses})))
                  AND (COALESCE(json_extract(document, '$.summary.source_warehouse_id'), 0) = 0 OR json_extract(document, '$.summary.source_warehouse_id') IN (SELECT value FROM json_each({visibleWarehouses})))
                  AND (COALESCE(json_extract(document, '$.summary.bin_id'), '') = '' OR json_extract(document, '$.summary.bin_id') IN (SELECT value FROM json_each({visibleBins})))
                  AND (json_extract(document, '$.action') != 'physical-bin-create' OR json_extract(document, '$.summary.record_id') IN (SELECT value FROM json_each({visibleBins})))
                  AND (COALESCE(json_extract(document, '$.summary.order_id'), 0) = 0 OR 'salesorder:' || json_extract(document, '$.summary.order_id') IN (SELECT value FROM json_each({visibleReferences})))
                  AND (COALESCE(json_extract(document, '$.summary.reference_type'), '') = '' OR
                      json_extract(document, '$.summary.reference_type') || ':' || json_extract(document, '$.summary.reference_id') IN (SELECT value FROM json_each({visibleReferences})))
              ))
              AND ({code} = '' OR EXISTS (
                  SELECT 1 FROM json_tree(COALESCE(json_extract(document, '$.summary.codes'), json_object(
                      'code', json_extract(document, '$.context.code'), 'codes', json_extract(document, '$.context.codes'),
                      'from', json_extract(document, '$.context.from'), 'to', json_extract(document, '$.context.to'),
                      'result_code', json_extract(document, '$.context.result.code'), 'result_codes', json_extract(document, '$.context.result.codes'),
                      'changes', json_extract(document, '$.context.result.changes'),
                      'result', CASE WHEN json_extract(document, '$.action') IN ('create', 'register', 'native-finish')
                          AND json_type(document, '$.context.result') IN ('text', 'array') THEN json_extract(document, '$.context.result') END)))
                  WHERE atom = {code} OR key = {code}))
              AND ({user} = 0 OR json_extract(document, '$.user_id') = {user})
              AND ({from} = '' OR julianday(json_extract(document, '$.at')) >= julianday({from}))
              AND ({to} = '' OR julianday(json_extract(document, '$.at')) < julianday({to}))
              AND ({query} = '' OR instr(lower(COALESCE(json_extract(document, '$.summary'), json_object(
                  'action', json_extract(document, '$.action'), 'code', json_extract(document, '$.context.code'),
                  'codes', json_extract(document, '$.context.codes'), 'kind', json_extract(document, '$.context.kind'),
                  'reason', json_extract(document, '$.context.reason'), 'args', json_extract(document, '$.context.args'),
                  'changes', json_extract(document, '$.context.result.changes')))), lower({query})) > 0)"
            )
            .AsNoTracking();
        var total = rows.Count();
        var entries = new JsonArray();
        foreach (
            var row in rows.OrderByDescending(row => row.Id).Skip((page - 1) * size).Take(size)
        )
        {
            var entry = Services.ActionHistory.Project((JsonObject)JsonNode.Parse(row.Document)!);
            entry["id"] = row.Id;
            entries.Add(entry);
        }
        native.Commit();
        return Json.Object(
            ("entries", entries),
            ("total", total),
            ("page", page),
            ("page_size", size)
        );
    }

    private readonly string directory = Path.GetFullPath(settings.Value.DataDirectory);
    private readonly ConcurrentDictionary<int, Lazy<bool>> initialized = new();
    private static readonly string[] Maps =
    [
        "items",
        "batches",
        "personal_warehouses",
        "location_label_settings",
        "location_levels",
        "pick_lists",
        "physical_bins",
    ];

    // Serialize initialization per entity in this process. Evict failed initialization so a
    // corrected migration/import problem can be retried by a later request.
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
            ["location_label_settings"] = new JsonObject(),
            ["location_levels"] = new JsonObject(),
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
        if (state["binloc_label_settings"] is not null)
        {
            state["location_label_settings"] = state["binloc_label_settings"]!.DeepClone();
            state.Remove("binloc_label_settings");
        }
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

    // Partial selections are for reads only. Include native-observed arrivals as well as cached
    // warehouse matches; updates need a complete document because Save removes absent records.
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
                || row.Collection == "location_label_settings"
                || row.Collection == "location_levels"
                || row.Collection == "pick_lists"
                || row.Collection == "physical_bins"
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

    /// <summary>
    /// Mutate and append audit in one transaction. Callback failures leave stored state/revision
    /// unchanged; external native stock has a separate recoverable synchronization protocol.
    /// </summary>
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
        var audit = Json.Object(
            ("at", Json.Now),
            ("user_id", user),
            ("action", action),
            ("context", context),
            ("revision", state.I("revision"))
        );
        audit["summary"] = Services.ActionHistory.Project(audit, state);
        ((JsonArray)state["history"]!).Add(audit);
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
