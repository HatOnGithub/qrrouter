using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using QrRouterApi.Helpers;

namespace QrRouterApi.Repositories;

public interface IStateRepository
{
    T Read<T>(int entity, Func<JsonObject, T> read);
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
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    private FileStream Lock(int entity)
    {
        Json.Require(entity > 0, "Invalid entity");
        var path = Path.Combine(directory, $"entity-{entity}");
        Directory.CreateDirectory(path);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            );
        for (var retry = 0; ; retry++)
        {
            try
            {
                var stream = new FileStream(
                    Path.Combine(path, "state.lock"),
                    FileMode.OpenOrCreate,
                    FileAccess.ReadWrite,
                    FileShare.None
                );
                try
                {
                    if (!OperatingSystem.IsWindows())
                        File.SetUnixFileMode(
                            Path.Combine(path, "state.lock"),
                            UnixFileMode.UserRead | UnixFileMode.UserWrite
                        );
                    return stream;
                }
                catch
                {
                    stream.Dispose();
                    throw;
                }
            }
            catch (IOException) when (retry < 200)
            {
                Thread.Sleep(25);
            }
        }
    }

    private string PathFor(int entity) => Path.Combine(directory, $"entity-{entity}", "state.json");

    private JsonObject Load(int entity)
    {
        if (!File.Exists(PathFor(entity)))
            return new JsonObject
            {
                ["schema"] = 2,
                ["revision"] = 0,
                ["items"] = new JsonObject(),
                ["history"] = new JsonArray(),
                ["personal_warehouses"] = new JsonObject(),
                ["batches"] = new JsonObject(),
            };
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(PathFor(entity), UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var state =
            JsonNode.Parse(File.ReadAllText(PathFor(entity))) as JsonObject
            ?? throw new InvalidDataException("Invalid inventory state");
        Validate(state);
        return state;
    }

    public static void Validate(JsonObject state)
    {
        if (state.I("schema") != 2 || state["history"] is not JsonArray)
            throw new InvalidDataException("Expected schema 2 inventory with history");
        foreach (
            var key in new[] { "items", "batches", "personal_warehouses", "binloc_label_settings" }
        )
            state.Map(key);
        foreach (var pair in state.Map("items"))
            if (
                pair.Value is not JsonObject
                || pair.Value.S("code") != pair.Key
                || !Services.Codes.Valid(pair.Key)
            )
                throw new InvalidDataException("Invalid item identity in inventory");
    }

    public T Read<T>(int entity, Func<JsonObject, T> read)
    {
        using var fileLock = Lock(entity);
        return read(Load(entity));
    }

    public T Update<T>(
        int entity,
        int user,
        string action,
        JsonObject context,
        Func<JsonObject, T> update
    )
    {
        using var fileLock = Lock(entity);
        var state = Load(entity);
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
        var target = PathFor(entity);
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (
                var stream = new FileStream(
                    temporary,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None
                )
            )
            {
                if (!OperatingSystem.IsWindows())
                    File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                JsonSerializer.Serialize(stream, state, Options);
                stream.Flush(true);
            }
            File.Move(temporary, target, true);
        }
        finally
        {
            if (File.Exists(temporary))
                File.Delete(temporary);
        }
        return result;
    }
}
