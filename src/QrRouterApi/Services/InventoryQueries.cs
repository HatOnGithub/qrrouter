using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using QrRouterApi.Helpers;
using static QrRouterApi.Helpers.Json;

namespace QrRouterApi.Services;

// Read models use the same authoritative state as commands; no client-supplied item snapshots.
public static class InventoryQueries
{
    private static readonly IComparer<string> Natural = Comparer<string>.Create(
        (a, b) =>
        {
            var left = Regex.Split(a, "([0-9]+)");
            var right = Regex.Split(b, "([0-9]+)");
            for (var i = 0; i < Math.Min(left.Length, right.Length); i++)
            {
                var x = left[i];
                var y = right[i];
                int result;
                if (i % 2 == 1)
                {
                    x = x.TrimStart('0');
                    y = y.TrimStart('0');
                    result = x.Length.CompareTo(y.Length);
                    if (result == 0)
                        result = string.CompareOrdinal(x, y);
                }
                else
                    result = string.Compare(x, y, StringComparison.OrdinalIgnoreCase);
                if (result != 0)
                    return result;
            }
            return left.Length.CompareTo(right.Length);
        }
    );

    private static IEnumerable<JsonNode> Items(JsonObject state) =>
        state.Map("items").Select(p => p.Value!);

    private static bool Visible(JsonNode item, int wid) =>
        item.S("type") != "unassigned"
        && item.S("status") != "consumed"
        && item["pending_handoff"] is null
        && item["pending_operation"] is null
        && item.I("warehouse_id") == wid;

    private static JsonNode Product(JsonObject data, int pid, string label = "") =>
        data["products"]?[pid.ToString()].Copy()
        ?? Object(("ref", pid > 0 ? $"Product #{pid}" : "Unassigned"), ("label", label));

    public static JsonNode Execute(JsonObject state, string action, JsonObject data)
    {
        // The trusted adapter supplies the object visibility established by Dolibarr.
        if (data["visible_codes"] is JsonArray codes)
        {
            var visible = codes
                .Select(code => code!.GetValue<string>())
                .ToHashSet(StringComparer.Ordinal);
            state = (JsonObject)state.DeepClone();
            var items = state.Map("items");
            foreach (
                var code in items
                    .Select(pair => pair.Key)
                    .Where(code => !visible.Contains(code))
                    .ToArray()
            )
                items.Remove(code);
            foreach (
                var batch in state.Map("batches").Select(pair => pair.Value).OfType<JsonObject>()
            )
                batch["codes"] = new JsonArray(
                    (batch["codes"] as JsonArray ?? [])
                        .Where(code => visible.Contains(code!.GetValue<string>()))
                        .Select(code => code!.DeepClone())
                        .ToArray()
                );
        }
        return action switch
        {
            "query-location-choice" => Locations.Choice(state, data),
            "query-location-levels" => Locations.Levels(state, data.I("warehouse_id")),
            "query-location-label" => JsonValue.Create(Locations.Display(state, data))!,
            "query-bin-summary" => BinSummary(state, data),
            "query-warehouse-summary" => WarehouseSummary(state, data),
            "query-known-bins" => new JsonArray(
                Items(state)
                    .Where(i => i.I("warehouse_id") == data.I("warehouse_id") && i.S("bin") != "")
                    .Select(i => i.S("bin"))
                    .Distinct()
                    .Order(Natural)
                    .Select(x => (JsonNode?)JsonValue.Create(x))
                    .ToArray()
            ),
            "query-batches" => Batches(state),
            "query-pick" => Pick(state, data),
            _ => throw new ArgumentException("Unknown read model"),
        };
    }

    private static JsonNode BinSummary(JsonObject state, JsonObject data)
    {
        var levelId = data.I("level_id");
        var levelValue = data.S("level_value").Trim();
        var level =
            levelId > 0
                ? Locations
                    .Levels(state, data.I("warehouse_id"))
                    .FirstOrDefault(level => level!.I("id") == levelId)
                : null;
        Require(levelId == 0 || level is not null, "Unknown report location level");
        Require(
            levelValue.Length <= 140 && !levelValue.Any(char.IsControl),
            "Invalid report location value"
        );
        Require(levelValue == "" || levelId > 0, "Choose a report location level");
        var levelLabel = levelValue;
        if (levelValue != "" && level.S("datatype") is "list" or "letter")
        {
            var option = (level!["options"] as JsonArray ?? []).FirstOrDefault(option =>
                option!.I("id").ToString() == levelValue
            );
            Require(option is not null, "Location option is unavailable");
            levelLabel = option.S("value");
        }
        var tracked = new List<JsonNode>();
        var totals = new Dictionary<int, JsonObject>();
        foreach (
            var item in Items(state)
                .Where(i =>
                    Visible(i, data.I("warehouse_id"))
                    && (data.S("bin") == "" || i.S("bin") == data.S("bin"))
                    && (
                        levelValue == ""
                        || string.Equals(
                            i["bin_values"]?[levelId.ToString()]?.ToString().Trim(),
                            levelValue,
                            StringComparison.OrdinalIgnoreCase
                        )
                    )
                )
        )
        {
            var pid = item.I("product_id");
            var product = Product(data, pid);
            if (item.S("type") == "tracked")
            {
                var copy = item.DeepClone();
                copy["_product"] = product;
                tracked.Add(copy);
                continue;
            }
            if (!totals.TryGetValue(pid, out var total))
                totals[pid] = total = Object(
                    ("product_id", pid),
                    ("product", product),
                    ("generic", 0),
                    ("box", 0),
                    ("unknown_boxes", 0),
                    ("codes", new JsonArray())
                );
            var key =
                item.S("type") == "generic" ? "generic"
                : item["qty"] is null ? "unknown_boxes"
                : "box";
            total[key] = checked(total.I(key) + (key == "box" ? item.I("qty") : 1));
            ((JsonArray)total["codes"]!).Add(item.S("code"));
        }
        return Object(
            ("scope", levelValue != "" ? level.S("label") + ": " + levelLabel : ""),
            ("tracked", tracked.OrderBy(i => i.S("code"), Natural)),
            ("totals", totals.Values.OrderBy(i => i["product"].S("ref"), Natural))
        );
    }

    private static JsonNode WarehouseSummary(JsonObject state, JsonObject data)
    {
        var result = new JsonObject();
        foreach (
            var item in Items(state)
                .Where(i => Visible(i, data.I("warehouse_id")) && i.I("product_id") > 0)
        )
        {
            var key = item.I("product_id").ToString();
            var row = result[key] as JsonObject;
            if (row is null)
                result[key] = row = Object(("known", 0), ("unknown", 0));
            var unknown = item.S("type") == "box" && item["qty"] is null;
            var field = unknown ? "unknown" : "known";
            row[field] = checked(
                row.I(field) + (unknown || item.S("type") != "box" ? 1 : item.I("qty"))
            );
        }
        return result;
    }

    private static JsonNode Batches(JsonObject state)
    {
        var items = state.Map("items");
        var inBatches = new HashSet<string>();
        var rows = new Dictionary<string, JsonObject>();
        var remaining = 0;
        foreach (var pair in state.Map("batches"))
        {
            if (pair.Value is not JsonObject raw)
                continue;
            var codes = (raw["codes"] as JsonArray ?? [])
                .Select(n => n!.GetValue<string>())
                .Where(Codes.Valid)
                .Distinct()
                .ToArray();
            var unused = codes.Count(code => items[code].S("type") == "unassigned");
            inBatches.UnionWith(codes);
            if (unused > 0)
                remaining++;
            rows[pair.Key] = Object(
                ("total", codes.Length),
                ("unassigned", unused),
                ("codes", codes),
                ("created_at", raw.S("created_at"))
            );
        }
        var ordered = new JsonObject();
        foreach (
            var pair in rows.OrderByDescending(p =>
                    DateTimeOffset.TryParse(p.Value.S("created_at"), out var at)
                        ? at
                        : DateTimeOffset.MinValue
                )
                .ThenByDescending(p => p.Key, StringComparer.Ordinal)
        )
            ordered[pair.Key] = pair.Value;
        var unassigned = items
            .Where(p => p.Value.S("type") == "unassigned")
            .Select(p => p.Key)
            .ToArray();
        return Object(
            ("unassigned_total", unassigned.Length),
            ("remaining_batches", remaining),
            ("batches", ordered),
            ("unbatched", unassigned.Where(c => !inBatches.Contains(c)).Order(Natural))
        );
    }

    private static JsonNode Pick(JsonObject state, JsonObject data)
    {
        var available = Items(state)
            .Where(i =>
                Visible(i, data.I("warehouse_id"))
                && i["checkout"] is null
                && i.S("bin") != ""
                && i.I("product_id") > 0
                && (i.S("type") != "box" || i["qty"] is not null)
            )
            .OrderBy(i => i.S("bin"), Natural)
            .ThenBy(i => i.S("code"), Natural)
            .Select(i => new Allocation(i, i.S("type") == "box" ? i.I("qty") : 1))
            .ToList();
        var rows = new List<JsonObject>();
        foreach (var node in data["lines"] as JsonArray ?? [])
        {
            var line = node ?? throw new ArgumentException("Invalid order line");
            var pid = line.I("product_id");
            var remaining = line["qty"]!.GetValue<double>();
            foreach (var item in available.Where(i => i.Item.I("product_id") == pid))
            {
                if (remaining <= 0)
                    break;
                var take = Math.Min(remaining, item.Remaining);
                if (take <= 0)
                    continue;
                rows.Add(
                    Object(
                        ("bin", item.Item.S("bin")),
                        ("code", item.Item.S("code")),
                        ("label", item.Item.S("label")),
                        ("product", Product(data, pid, line.S("label"))),
                        ("take", take),
                        ("type", item.Item.S("type"))
                    )
                );
                remaining -= take;
                item.Remaining -= take;
            }
            if (remaining > 0)
                rows.Add(
                    Object(
                        ("bin", "NOT ALLOCATED"),
                        ("code", ""),
                        ("label", ""),
                        ("product", Product(data, pid, line.S("label"))),
                        ("take", remaining),
                        ("type", "missing")
                    )
                );
        }
        return System.Text.Json.JsonSerializer.SerializeToNode(
            rows.OrderBy(r => r.S("bin"), Natural)
        )!;
    }

    private sealed class Allocation(JsonNode item, double remaining)
    {
        public JsonNode Item { get; } = item;
        public double Remaining { get; set; } = remaining;
    }
}
