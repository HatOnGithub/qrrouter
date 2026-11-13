using System.Text;
using System.Text.Json.Nodes;
using QrRouterApi.Helpers;
using static QrRouterApi.Helpers.Json;

namespace QrRouterApi.Services;

// Entity-scoped location definitions and assignments live in the service database.
public static class Locations
{
    private static void Warehouse(JsonObject data) =>
        Require(
            data.I("warehouse_id") > 0
                && data["warehouses"]?[data.I("warehouse_id").ToString()] is not null,
            "Unknown warehouse"
        );

    public static JsonArray Levels(JsonObject state, int warehouse) =>
        state.Map("location_levels")[warehouse.ToString()]?["levels"]?.DeepClone() as JsonArray
        ?? new JsonArray(
            Object(
                ("id", 1),
                ("label", "Location"),
                ("datatype", "text"),
                ("options", new JsonArray())
            )
        );

    public static JsonObject Choice(JsonObject state, JsonObject data)
    {
        var warehouse = data.I("warehouse_id");
        var raw = data["levels"] as JsonObject;
        if (
            data["levels"] is not null
            && raw is null
            && data["levels"] is not JsonArray { Count: 0 }
        )
            throw new ArgumentException("Invalid location level data");
        if (warehouse == 0)
            return Object(("bin", ""), ("bin_key", ""), ("bin_values", new JsonObject()));
        Warehouse(data);
        var levels = Levels(state, warehouse);
        var values = new JsonObject();
        var keys = new List<string>();
        var parts = new List<string>();
        var gap = false;
        var known = levels.Select(level => level!.I("id").ToString()).ToHashSet();
        if (
            raw is not null
            && raw.Any(pair => !known.Contains(pair.Key) && pair.Value?.ToString() != "")
        )
            throw new ArgumentException(
                "Unknown location level; refresh the warehouse configuration"
            );
        foreach (var level in levels)
        {
            var id = level!.I("id").ToString();
            var node = raw?[id];
            if (node is JsonObject or JsonArray)
                throw new ArgumentException("Invalid location level value");
            var value = node?.ToString().Trim() ?? "";
            if (value == "")
            {
                gap = true;
                continue;
            }
            Require(!gap, "Choose location levels in order, without gaps");
            Require(
                Encoding.UTF8.GetByteCount(value) <= (levels.Count == 1 ? 140 : 64)
                    && !value.Any(c => char.IsControl(c) || c is '<' or '>'),
                "Invalid location value (maximum 64 UTF-8 bytes per level)"
            );
            if (level.S("datatype") is "list" or "letter")
            {
                var option = (level!["options"] as JsonArray ?? []).FirstOrDefault(o =>
                    o!.I("id").ToString() == value
                );
                Require(option is not null, "Location option is unavailable");
                values[id] = option!.I("id");
                keys.Add(id + ":o" + value);
                parts.Add(option.S("value"));
            }
            else
            {
                Require(
                    level.S("datatype") != "number"
                        || decimal.TryParse(
                            value,
                            System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture,
                            out _
                        ),
                    "Numeric location required"
                );
                values[id] = value;
                keys.Add(id + ":v" + value.ToLowerInvariant());
                parts.Add(value);
            }
        }
        var settings = state.Map("location_levels")[warehouse.ToString()];
        var separator = settings.S("separator", "-");
        var prefix = settings.B("show_warehouse")
            ? data["warehouses"]?[warehouse.ToString()].S("ref") ?? ""
            : "";
        var bin =
            parts.Count == 0
                ? ""
                : (prefix != "" ? prefix + separator : "") + string.Join(separator, parts);
        Require(Encoding.UTF8.GetByteCount(bin) <= 140, "Location code exceeds the size limit");
        return Object(("bin", bin), ("bin_key", string.Join('|', keys)), ("bin_values", values));
    }

    public static JsonNode Configure(JsonObject state, JsonObject data)
    {
        Warehouse(data);
        var warehouse = data.I("warehouse_id");
        var names =
            data["names"] as JsonArray ?? throw new ArgumentException("Enter location level names");
        Require(
            !state
                .Map("items")
                .Any(pair =>
                    pair.Value?["pending_operation"] is not null
                    || pair.Value?["pending_handoff"] is not null
                ),
            "Resolve pending stock operations before changing location definitions"
        );
        Require(names.Count is > 0 and <= 8, "Configure between one and eight location levels");
        var current = Levels(state, warehouse);
        var datatypes = data["datatypes"] as JsonArray;
        var optionAdditions = data["option_additions"] as JsonArray;
        Require(
            data["datatypes"] is null || datatypes is not null && datatypes.Count == names.Count,
            "Choose one datatype per location level"
        );
        Require(
            data["option_additions"] is null
                || optionAdditions is not null && optionAdditions.Count == names.Count,
            "Invalid location option additions"
        );
        var inUse = state
            .Map("items")
            .Any(p => p.Value!.I("warehouse_id") == warehouse && p.Value.S("bin") != "");
        Require(
            !inUse || names.Count >= current.Count,
            "Cannot remove location levels while locations are in use"
        );
        var configured = new JsonArray();
        var unique = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < names.Count; i++)
        {
            var name = Creation.Text(Object(("name", names[i])), "name", 64);
            Require(
                name != "" && unique.Add(name),
                "Location level names must be nonempty and unique"
            );
            var level =
                i < current.Count
                    ? (JsonObject)current[i]!.DeepClone()
                    : Object(
                        ("id", current.Max(level => level!.I("id")) + i - current.Count + 1),
                        ("datatype", "text"),
                        ("options", new JsonArray())
                    );
            level["label"] = name;
            var datatype = datatypes?[i]?.ToString() ?? level.S("datatype");
            Require(
                datatype is "text" or "number" or "letter" or "list",
                "Unsupported location datatype"
            );
            var id = level.I("id").ToString();
            if (i < current.Count && datatype != level.S("datatype"))
            {
                var used = state
                    .Map("items")
                    .Any(pair =>
                        pair.Value!.I("warehouse_id") == warehouse
                        && (
                            pair.Value?["bin_values"]?[id]?.ToString() is string value
                                && value != ""
                            || pair.Value.S("bin") != ""
                                && pair.Value?["bin_values"] is not JsonObject { Count: > 0 }
                        )
                    );
                Require(!used, "Cannot change the datatype of a level with saved assignments");
            }
            level["datatype"] = datatype;
            var additions = optionAdditions is not null
                ? optionAdditions[i] as JsonArray
                : data["options"]?[id] as JsonArray;
            Require(
                optionAdditions is null || additions is not null,
                "Invalid location option additions"
            );
            if (datatype is "list" or "letter")
            {
                var options = level["options"] as JsonArray ?? [];
                var next = options.Count == 0 ? 1 : options.Max(option => option!.I("id")) + 1;
                if (datatype == "letter" && options.Count == 0)
                {
                    foreach (var letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
                        options.Add(Object(("id", next++), ("value", letter.ToString())));
                }
                foreach (var value in additions ?? [])
                {
                    var text = Creation.Text(Object(("option", value)), "option", 64);
                    Require(text != "", "Location options must have a value");
                    if (datatype == "letter")
                    {
                        Require(
                            text.All(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z'),
                            "Letter options must contain letters only"
                        );
                        text = text.ToUpperInvariant();
                    }
                    if (
                        !options.Any(option =>
                            string.Equals(
                                option.S("value"),
                                text,
                                StringComparison.OrdinalIgnoreCase
                            )
                        )
                    )
                        options.Add(Object(("id", next++), ("value", text)));
                }
                if (level["options"] is null)
                    level["options"] = options;
                if (datatype == "letter")
                    Require(
                        options.All(option =>
                            option.S("value").All(c => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z')
                        ),
                        "Letter options must contain letters only"
                    );
            }
            configured.Add(level);
        }
        var existing =
            state.Map("location_levels")[warehouse.ToString()] as JsonObject ?? new JsonObject();
        existing["levels"] = configured;
        state.Map("location_levels")[warehouse.ToString()] = existing;
        return configured.DeepClone();
    }

    public static string Display(JsonObject state, JsonObject data)
    {
        var item = state.Map("items")[data.S("code")];
        if (item is null)
            return "";
        var warehouse = item.I("warehouse_id");
        var prefs = state.Map("location_label_settings")[warehouse.ToString()];
        if (!prefs.B("enabled"))
            return item.S("bin");
        var text = prefs.B("show_warehouse")
            ? data["warehouses"]?[warehouse.ToString()].S("ref") ?? ""
            : "";
        var visible = 0;
        foreach (var level in Levels(state, warehouse))
        {
            var id = level!.I("id").ToString();
            if (prefs?["show"]?[id] is null)
                continue;
            var value = item["bin_values"]?[id]?.ToString() ?? "";
            if (value == "")
                continue;
            if (level.S("datatype") is "list" or "letter")
                value = (level!["options"] as JsonArray ?? [])
                    .FirstOrDefault(o => o!.I("id").ToString() == value)
                    .S("value");
            if (value == "")
                return item.S("bin");
            text += (text == "" ? "" : prefs?["separator"].S(id, "-") ?? "-") + value;
            visible++;
        }
        return visible == 0 ? item.S("bin") : text;
    }

    public static JsonNode Import(JsonObject state, JsonObject data)
    {
        var configurations =
            data["configurations"] as JsonObject
            ?? throw new ArgumentException("Missing location definitions");
        var imported = new HashSet<int>();
        foreach (var pair in configurations)
        {
            Require(
                int.TryParse(pair.Key, out var wid)
                    && wid > 0
                    && data["warehouses"]?[pair.Key] is not null,
                "Location import contains an inaccessible warehouse"
            );
            if (state.Map("location_levels")[pair.Key] is not null)
                continue;
            Require(
                pair.Value?["levels"] is JsonArray { Count: > 0 },
                "Invalid imported location levels"
            );
            state.Map("location_levels")[pair.Key] = pair.Value!.DeepClone();
            imported.Add(wid);
        }
        Require(
            imported.Count > 0,
            "Locations already configured; import is allowed only once per warehouse"
        );
        foreach (var pair in data["assignments"] as JsonObject ?? [])
        {
            if (!imported.Contains(pair.Value!.I("warehouse_id")))
                continue;
            var item =
                state.Map("items")[pair.Key]
                ?? throw new ArgumentException("Unknown QR item in location import");
            Require(
                item["pending_operation"] is null && item["pending_handoff"] is null,
                "Resolve pending stock operations before importing locations"
            );
            var warehouse = pair.Value!.I("warehouse_id");
            Require(
                item.I("warehouse_id") == warehouse,
                "Imported location differs from the stock warehouse"
            );
            var choice = Choice(
                state,
                Object(
                    ("warehouse_id", warehouse),
                    ("levels", pair.Value!["levels"]),
                    ("warehouses", data["warehouses"])
                )
            );
            foreach (var field in choice)
                item[field.Key] = field.Value.Copy();
        }
        return JsonValue.Create("Locations imported into QR Router")!;
    }
}
