using System.Text.Json.Nodes;
using QrRouterApi.DTO;
using QrRouterApi.Helpers;
using static QrRouterApi.Helpers.Json;

namespace QrRouterApi.Services;

/// <summary>
/// Movable bin identity/membership. Packing is metadata only; whole-bin moves freeze a target
/// and member set while PHP moves each member through the ordinary native stock protocol.
/// </summary>
public static class PhysicalBins
{
    private static JsonObject Bin(JsonObject state, string id) =>
        state.Map("physical_bins")[id] as JsonObject
        ?? throw new InvalidOperationException("Physical bin not found");

    private static IEnumerable<JsonNode> Members(JsonObject state, string id) =>
        state
            .Map("items")
            .Select(pair => pair.Value!)
            .Where(item => item.S("physical_bin_id") == id);

    private static bool At(JsonNode item, JsonNode location) =>
        item.I("warehouse_id") == location.I("warehouse_id")
        && item.S("bin_key") == location.S("bin_key")
        && (item.S("bin_key") != "" || item.S("bin") == location.S("bin"));

    private static JsonObject Target(JsonObject data)
    {
        var target = (JsonObject)(data["choice"].Copy() ?? new JsonObject());
        target["warehouse_id"] = data.I("warehouse_id");
        Require(target.I("warehouse_id") > 0, "Choose a warehouse");
        return target;
    }

    public static JsonNode Create(JsonObject state, JsonObject data, Actor actor)
    {
        var label = data.S("label").Trim();
        Require(
            label.Length is > 0 and <= 140,
            "Enter a physical bin name (maximum 140 characters)"
        );
        var id = Codes.New();
        while (state.Map("physical_bins")[id] is not null)
            id = Codes.New();
        var bin = Target(data);
        bin["id"] = id;
        bin["label"] = label;
        bin["created_at"] = Now;
        bin["created_by"] = actor.UserId;
        state.Map("physical_bins")[id] = bin;
        return Report(state, bin);
    }

    public static JsonNode Assign(JsonObject state, JsonObject data)
    {
        var bin = Bin(state, data.S("bin_id"));
        Require(bin["pending_move"] is null, "Finish the physical bin move first");
        var codes =
            data["codes"] as JsonArray
            ?? throw new ArgumentException("Scan items to pack or unpack");
        Require(codes.Count is > 0 and <= 200, "Scan between 1 and 200 items");
        foreach (var code in codes)
        {
            var item =
                state.Map("items")[code!.GetValue<string>()] as JsonObject
                ?? throw new InvalidOperationException("Unknown item");
            Require(
                item["pending_bin_move"] is null
                    && item["pending_operation"] is null
                    && item["pending_handoff"] is null,
                "Reconcile pending item movements first"
            );
            if (data.B("remove"))
            {
                Require(
                    item.S("physical_bin_id") == bin.S("id"),
                    "Item is not in this physical bin"
                );
                item.Remove("physical_bin_id");
            }
            else
            {
                Require(
                    item.S("type") != "unassigned"
                        && item.S("status") != "consumed"
                        && item["checkout"] is null
                        && At(item, bin),
                    "Only available items at the physical bin's location can be packed"
                );
                Require(
                    item.S("physical_bin_id") == "" || item.S("physical_bin_id") == bin.S("id"),
                    "Unpack the item from its current physical bin first"
                );
                item["physical_bin_id"] = bin.S("id");
            }
            item["updated_at"] = Now;
        }
        return Report(state, bin);
    }

    /// <summary>Lock members and persist a fixed move; another start returns the existing intent.</summary>
    public static JsonNode StartMove(JsonObject state, JsonObject data, Actor actor)
    {
        var bin = Bin(state, data.S("bin_id"));
        if (bin["pending_move"] is not null)
            return bin["pending_move"]!.DeepClone();
        var members = Members(state, bin.S("id")).ToArray();
        var target = Target(data);
        foreach (var item in members)
        {
            Require(
                item.S("type") != "unassigned"
                    && item.S("status") != "consumed"
                    && item["checkout"] is null
                    && item["pending_operation"] is null
                    && item["pending_handoff"] is null
                    && item["pending_bin_move"] is null
                    && At(item, bin),
                "Every packed item must be available at the bin's current location"
            );
            Require(
                target.I("warehouse_id") == bin.I("warehouse_id") || item["qty"] is not null,
                "Count all containers before moving a physical bin between warehouses"
            );
        }
        var move = Object(
            ("id", bin.S("id")),
            ("at", Now),
            ("user_id", actor.UserId),
            ("target", target),
            ("codes", members.Select(item => item.S("code")).ToArray())
        );
        bin["pending_move"] = move.DeepClone();
        foreach (var item in members)
            item["pending_bin_move"] = bin.S("id");
        return move;
    }

    // Only the matching active move/target can use marked items. Uncertain member operations
    // must be reconciled before this move resumes; ordinary workflows cannot take the lock.
    public static bool ValidateMove(JsonObject state, JsonNode item, string kind, JsonObject args)
    {
        if (item["pending_bin_move"] is null)
        {
            Require(args.S("physical_bin_move") == "", "Physical bin move is no longer active");
            return false;
        }
        var id = item.S("pending_bin_move");
        var target = Bin(state, id)["pending_move"]?["target"];
        Require(
            kind == "move"
                && args.S("physical_bin_move") == id
                && target is not null
                && target.I("warehouse_id") == args.I("warehouse_id")
                && target.S("bin_key") == args["choice"].S("bin_key"),
            "This item belongs to an unfinished physical bin move; resume that move first"
        );
        Require(
            item["pending_operation"] is null && item["pending_handoff"] is null,
            "Reconcile the pending item operation before resuming the bin move"
        );
        return true;
    }

    /// <summary>Release locks only after every fixed member is at the target without pending work.</summary>
    public static JsonNode FinishMove(JsonObject state, JsonObject data)
    {
        var bin = Bin(state, data.S("bin_id"));
        var move =
            bin["pending_move"] ?? throw new InvalidOperationException("No pending bin move");
        foreach (var code in (JsonArray)move["codes"]!)
        {
            var item = state.Map("items")[code!.GetValue<string>()]!;
            Require(
                item["pending_operation"] is null
                    && item["pending_handoff"] is null
                    && At(item, move["target"]!),
                "Some items have not completed the move; reconcile pending operations and resume"
            );
            item.AsObject().Remove("pending_bin_move");
        }
        foreach (var field in (JsonObject)move["target"]!)
            bin[field.Key] = field.Value.Copy();
        bin["updated_at"] = Now;
        bin.Remove("pending_move");
        return Report(state, bin);
    }

    private static JsonObject Report(JsonObject state, JsonNode bin)
    {
        var result = (JsonObject)bin.DeepClone();
        result["codes"] = new JsonArray(
            Members(state, bin.S("id"))
                .Select(item => JsonValue.Create(item.S("code")) as JsonNode)
                .ToArray()
        );
        return result;
    }

    public static JsonArray All(JsonObject state) =>
        new(
            state
                .Map("physical_bins")
                .Select(pair => (JsonNode)Report(state, pair.Value!))
                .ToArray()
        );
}
