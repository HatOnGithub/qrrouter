using System.Text.Json.Nodes;
using QrRouterApi.DTO;
using QrRouterApi.Helpers;
using static QrRouterApi.Helpers.Json;

namespace QrRouterApi.Services;

/// <summary>
/// Saved sales-order requirements and consumption-derived progress, without stock reservations.
/// Pending consumes count toward the allowance before another pick can be staged.
/// </summary>
public static class PickLists
{
    public static JsonNode Save(JsonObject state, JsonObject data, Actor actor)
    {
        Require(
            data.I("order_id") > 0 && data.I("warehouse_id") > 0,
            "Select an order and warehouse"
        );
        Require(data["lines"] is JsonArray { Count: > 0 }, "Order has no product lines");
        var key = data.I("order_id").ToString();
        var lists = state.Map("pick_lists");
        if (lists[key] is null)
            lists[key] = Object(
                ("order_id", data.I("order_id")),
                ("warehouse_id", data.I("warehouse_id")),
                ("lines", data["lines"].Copy()),
                ("created_at", Now),
                ("created_by", actor.UserId),
                ("status", "open")
            );
        return Progress(state, lists[key]!);
    }

    /// <summary>Audit closure of outstanding lines without inventing consumption or stock movements.</summary>
    public static JsonNode Complete(JsonObject state, JsonObject data, Actor actor)
    {
        var list = state.Map("pick_lists")[data.I("order_id").ToString()];
        Require(list is not null, "Save the pick list first");
        var progress = Progress(state, list!);
        Require(progress.S("status") is "open" or "in_progress", "Pick list is already complete");
        Require(
            ((JsonArray)progress["lines"]!).All(line => line!.I("pending") == 0),
            "Reconcile pending picks before manual completion"
        );
        var reason = data.S("reason").Trim();
        Require(
            reason.Length is > 0 and <= 200,
            "Enter a reason for manual completion (maximum 200 characters)"
        );
        list!["status"] = "manually_completed";
        list["completed_at"] = Now;
        list["completed_by"] = actor.UserId;
        list["completion_reason"] = reason;
        list["manual_lines"] = progress["lines"].Copy();
        return Progress(state, list);
    }

    public static JsonArray All(JsonObject state) =>
        new(
            state.Map("pick_lists").Select(pair => (JsonNode)Progress(state, pair.Value!)).ToArray()
        );

    private static JsonObject Progress(JsonObject state, JsonNode list)
    {
        var output = (JsonObject)list.DeepClone();
        var lines = new JsonArray();
        var pickedTotal = 0;
        var remainingTotal = 0.0;
        var pendingTotal = 0;
        foreach (var group in ((JsonArray)list["lines"]!).GroupBy(line => line!.I("product_id")))
        {
            var requested = group.Sum(line => line!["qty"]!.GetValue<double>());
            var picked = 0;
            var pending = 0;
            foreach (
                var item in state
                    .Map("items")
                    .Select(pair => pair.Value!)
                    .Where(item => item.I("product_id") == group.Key)
            )
            {
                bool Matches(JsonNode? entry) =>
                    entry.S("kind") == "consume"
                    && entry.S("reference_type") == "salesorder"
                    && entry.I("reference_id") == list.I("order_id");
                picked += ((JsonArray?)item["consumption_log"] ?? [])
                    .Where(Matches)
                    .Sum(entry => entry!.I("quantity"));
                if (Matches(item["pending_operation"]))
                    pending += item["pending_operation"]!.I("amount");
            }
            var remaining = Math.Max(0, requested - picked);
            var manual =
                list.S("status") == "manually_completed"
                    ? ((JsonArray?)list["manual_lines"] ?? [])
                        .Where(line => line!.I("product_id") == group.Key)
                        .Sum(line => line!["remaining"]!.GetValue<double>())
                    : 0;
            lines.Add(
                Object(
                    ("product_id", group.Key),
                    ("requested", requested),
                    ("picked", picked),
                    ("pending", pending),
                    ("manual", manual),
                    ("remaining", Math.Max(0, remaining - manual))
                )
            );
            pickedTotal += picked;
            remainingTotal += remaining;
            pendingTotal += pending;
        }
        output["lines"] = lines;
        if (list.S("status") != "manually_completed")
            output["status"] =
                remainingTotal == 0 && pendingTotal == 0 ? "completed"
                : pickedTotal > 0 || pendingTotal > 0 ? "in_progress"
                : "open";
        return output;
    }
}
