using System.Text.Json.Nodes;
using QrRouterApi.Helpers;
using static QrRouterApi.Helpers.Json;

namespace QrRouterApi.Services;

/// <summary>
/// Public audit summaries independent of private contexts/snapshots. Saved visibility metadata
/// lets the repository apply current native object scopes before returning historical rows.
/// </summary>
public static class ActionHistory
{
    // Project only the action's affected records, never native synchronization snapshots.
    public static JsonObject Project(JsonObject entry, JsonObject? state = null)
    {
        if (entry["summary"] is JsonObject saved)
            return (JsonObject)saved.DeepClone();
        var context = entry["context"] as JsonObject ?? new JsonObject();
        var result = context["result"] as JsonObject ?? new JsonObject();
        var args = context["args"] as JsonObject ?? new JsonObject();
        var action = entry.S("action");
        var operation = context.S("kind", result.S("kind", result.S("action", action)));
        if (action == "physical-bin-assign" && context.ContainsKey("remove"))
            operation = context.B("remove") ? "physical-bin-unpack" : "physical-bin-pack";
        var codes = new HashSet<string>(StringComparer.Ordinal);
        void Add(JsonNode? node)
        {
            if (
                node is JsonValue value
                && value.TryGetValue<string>(out var code)
                && Codes.Valid(code)
            )
                codes.Add(code);
            if (node is JsonArray array)
                foreach (var codeNode in array)
                    Add(codeNode);
        }
        Add(context["code"]);
        Add(context["codes"]);
        Add(context["from"]);
        Add(context["to"]);
        Add(result["code"]);
        Add(result["codes"]);
        if (context["result"] is JsonValue scalar && scalar.TryGetValue<string>(out var resultCode))
        {
            if (action is "create" or "native-finish")
                Add(scalar);
            if (action == "bulk" && state?["batches"] is JsonObject batches)
                Add(batches[resultCode]?["codes"]);
        }
        if (action is "register" or "native-finish")
            Add(context["result"]);
        if (result["changes"] is JsonObject changes)
            foreach (var pair in changes)
                Add(JsonValue.Create(pair.Key));
        var status =
            action is "stage" or "handoff-stage" or "native-stage" or "physical-bin-move-start"
                ? "Started"
            : action is "native-cancel" ? "Cancelled"
            : action is "reconcile" or "handoff-reconcile" ? "Reconciled"
            : "Completed";
        if (action == "stage" && result.ContainsKey("id") && result.S("id") == "")
            status = "Completed";
        if (
            context["result"] is JsonValue message
            && message.TryGetValue<string>(out var text)
            && text.StartsWith("Cancelled pending operation", StringComparison.Ordinal)
        )
            status = "Cancelled";
        var quantity = context.ContainsKey("quantity")
            ? context["quantity"].Copy()
            : args["quantity"].Copy() ?? context["qty"].Copy() ?? result["amount"].Copy();
        return Object(
            ("visibility_version", 1),
            ("reference_type", context.S("reference_type", args.S("reference_type"))),
            ("reference_id", context.I("reference_id", args.I("reference_id"))),
            ("at", entry.S("at")),
            ("user_id", entry.I("user_id")),
            ("revision", entry.I("revision")),
            ("action", action),
            ("operation", operation),
            ("status", status),
            ("codes", codes.Order().ToArray()),
            ("reason", context.S("reason", args.S("reason", result.S("reason")))),
            ("quantity", quantity),
            (
                "warehouse_id",
                context.I("warehouse_id", args.I("warehouse_id", result.I("warehouse_id")))
            ),
            (
                "location",
                (context["choice"] as JsonObject).S(
                    "bin",
                    (args["choice"] as JsonObject).S(
                        "bin",
                        result.S("bin", (result["target"] as JsonObject).S("bin"))
                    )
                )
            ),
            ("label", context.S("label", result.S("label"))),
            (
                "order_id",
                context.I(
                    "order_id",
                    args.S("reference_type") == "salesorder" ? args.I("reference_id") : 0
                )
            ),
            ("bin_id", context.S("bin_id")),
            ("record_id", result.S("id")),
            ("source_warehouse_id", context.I("source_warehouse_id")),
            ("source_location", context.S("source_location"))
        );
    }
}
