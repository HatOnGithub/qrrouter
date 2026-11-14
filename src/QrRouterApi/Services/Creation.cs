using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using QrRouterApi.Helpers;

namespace QrRouterApi.Services;

// Pure creation rules. Native availability and access checks belong to the Dolibarr adapter.
public static class Creation
{
    public static string Text(JsonNode data, string key, int limit)
    {
        var value = data[key] is null ? "" : data[key]!.GetValue<string>();
        value = Regex.Replace(value, "<[^>]*>", "").Trim();
        if (Encoding.UTF8.GetByteCount(value) > limit)
            throw new ArgumentException($"{key} exceeds the size limit ({limit} UTF-8 bytes)");
        return value;
    }

    /// <summary>
    /// Prepare normalized labels/native identities without persistence or Dolibarr access.
    /// PHP supplies the trusted product prefix and checks native identity availability.
    /// </summary>
    public static JsonObject Prepare(JsonObject data)
    {
        var type = data.S("type", "generic");
        if (type is not ("tracked" or "generic" or "box" or "unassigned"))
            throw new ArgumentException("Invalid type");
        var bulk = data.B("bulk");
        var count = bulk ? data.I("count") : 1;
        if (count is < 1 or > 200)
            throw new ArgumentException("Batch size must be between 1 and 200");
        var label = Text(data, "label", type == "box" ? 100 : 140);
        var details = Text(data, "details", 2000);
        _ = Text(data, "serial", 100);
        var prefix = "SN-";
        if (type == "tracked" && (bulk || data.S("existing_serial") == ""))
        {
            var configured = data.S("serial_prefix").Trim();
            if (
                Encoding.UTF8.GetByteCount(configured) > 76
                || configured.Any(c => char.IsWhiteSpace(c) || char.IsControl(c) || c is '<' or '>')
            )
                throw new ArgumentException(
                    "Serial prefix must be at most 76 UTF-8 bytes without whitespace or markup"
                );
            if (configured != "")
                prefix = configured;
        }
        var labels = new List<string>();
        if (bulk && type is "tracked" or "box" && data.ContainsKey("labels"))
        {
            if (data["labels"] is not JsonArray array || array.Count != count)
                throw new ArgumentException("Enter one label per individual item.");
            foreach (var entry in array)
            {
                if (entry is not JsonValue value || !value.TryGetValue<string>(out var name))
                    throw new ArgumentException("Enter one label per individual item.");
                var clean = Text(Json.Object(("name", name)), "name", type == "box" ? 100 : 140);
                if (clean == "")
                    throw new ArgumentException("Enter one label per individual item.");
                labels.Add(clean);
            }
        }
        else
            labels.AddRange(
                Enumerable.Repeat(label, bulk && type is "tracked" or "box" ? count : 1)
            );
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var entries = new JsonArray();
        foreach (var name in labels)
        {
            var serial =
                type == "tracked"
                    ? (
                        !bulk && data.S("existing_serial") != ""
                            ? Text(data, "existing_serial", 100)
                            : prefix + Convert.ToHexString(RandomNumberGenerator.GetBytes(12))
                    )
                    : "";
            var identity = type == "box" ? name : serial;
            if (type is "tracked" or "box" && (identity == "" || !used.Add(identity)))
                throw new ArgumentException("Each box name must be nonempty and unique.");
            entries.Add(
                Json.Object(
                    ("type", type),
                    ("label", name),
                    ("serial", serial),
                    (
                        "generated_serial",
                        type == "tracked" && (bulk || data.S("existing_serial") == "")
                    ),
                    ("native_batch", identity),
                    ("details", details)
                )
            );
        }
        return Json.Object(("count", count), ("entries", entries));
    }
}
