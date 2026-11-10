using System.Text.Json.Nodes;

namespace QrRouterApi.Helpers;

public static class Json
{
    public static string S(this JsonNode? n, string key, string fallback = "") =>
        n?[key]?.GetValue<string>() ?? fallback;

    public static int I(this JsonNode? n, string key, int fallback = 0) =>
        n?[key]?.GetValue<int>() ?? fallback;

    public static bool B(this JsonNode? n, string key) => n?[key]?.GetValue<bool>() ?? false;

    public static JsonNode? Copy(this JsonNode? n) => n?.DeepClone();

    public static JsonObject Map(this JsonNode n, string key)
    {
        if (n[key] is JsonObject o)
            return o;
        if (n[key] is null || n[key] is JsonArray { Count: 0 })
            return (JsonObject)(n[key] = new JsonObject());
        throw new InvalidDataException($"Invalid map: {key}");
    }

    public static JsonObject Object(params (string Key, object? Value)[] values)
    {
        var o = new JsonObject();
        foreach (var (key, value) in values)
            o[key] = System.Text.Json.JsonSerializer.SerializeToNode(value);
        return o;
    }

    public static string Now => DateTimeOffset.UtcNow.ToString("O");

    public static void Require(bool valid, string message)
    {
        if (!valid)
            throw new InvalidOperationException(message);
    }
}
