using System.Security.Cryptography;
using System.Text.Json.Nodes;
using QrRouterApi.DTO;
using QrRouterApi.Helpers;
using QrRouterApi.Repositories;
using static QrRouterApi.Helpers.Json;

namespace QrRouterApi.Services;

public interface IInventoryService
{
    JsonObject State(Actor actor, bool includeHistory = true);
    JsonNode? Execute(Actor actor, string action, JsonObject data);
}

public sealed class InventoryService(IStateRepository repository) : IInventoryService
{
    private static void Permit(bool allowed)
    {
        if (!allowed)
            throw new UnauthorizedAccessException("Missing Dolibarr permission");
    }

    public JsonObject State(Actor actor, bool includeHistory = true)
    {
        Permit(actor.Read || actor.Manage || actor.Admin);
        return repository.Read(actor.EntityId, s => (JsonObject)s.DeepClone(), includeHistory);
    }

    public JsonNode? Execute(Actor actor, string action, JsonObject data)
    {
        if (action.StartsWith("query-", StringComparison.Ordinal))
        {
            Permit(actor.Read || actor.Manage || actor.Admin);
            return repository.Read(
                actor.EntityId,
                s =>
                {
                    RefreshNative(s, data, partial: true);
                    return InventoryQueries.Execute(s, action, data);
                },
                includeHistory: false,
                selection: action
                    is "query-bin-summary"
                        or "query-warehouse-summary"
                        or "query-known-bins"
                        or "query-pick"
                    ? new StateSelection(
                        data.I("warehouse_id"),
                        (data["native_items"] as JsonObject)
                            ?.Where(pair => pair.Value.I("warehouse_id") == data.I("warehouse_id"))
                            .Select(pair => pair.Key)
                            .ToArray()
                            ?? []
                    )
                    : null
            );
        }
        Permit(actor.Manage || actor.Admin);
        if (action == "prepare-creation")
            return Creation.Prepare(data);
        if (action == "validate")
            return Make(data, "");
        if (
            action
            is "finish"
                or "reconcile"
                or "handoff-plan"
                or "handoff-stage"
                or "handoff-finish"
                or "handoff-reconcile"
        )
            Permit(actor.Stock);
        if (action is "import" or "mapping")
            Permit(actor.Admin);
        if (action is "plan" or "handoff-plan")
            return repository.Read(
                actor.EntityId,
                s =>
                {
                    RefreshNative(s, data);
                    return Plan(s, data, actor, action == "handoff-plan");
                },
                includeHistory: false
            );
        var context = AuditContext(data);
        return repository.Update(
            actor.EntityId,
            actor.UserId,
            action,
            context,
            s =>
            {
                Require(
                    s["pending_native"] is null || action is "native-finish" or "native-cancel",
                    "Complete the pending Dolibarr synchronization first"
                );
                RefreshNative(s, data);
                var result = action switch
                {
                    "native-stage" => NativeStage(s, data, actor),
                    "native-finish" => NativeFinish(s, data, actor),
                    "native-cancel" => NativeCancel(s, data, actor),
                    "create" => Create(s, data),
                    "delete-unassigned" => DeleteUnassigned(s, data),
                    "bulk" => Bulk(s, data),
                    "register" => Register(s, data),
                    "update" => Edit(s, data),
                    "count" => EstablishCount(s, data),
                    "box-transfer" => Transfer(s, data),
                    "mapping" or "resolve-mapping" => Mapping(s, data),
                    "label-settings" => LabelSettings(s, data),
                    "location-configure" => Locations.Configure(s, data),
                    "location-import" => actor.Admin
                        ? Locations.Import(s, data)
                        : throw new UnauthorizedAccessException(
                            "Administrator permission required"
                        ),
                    "stage" => Stage(s, data, actor, false),
                    "handoff-stage" => Stage(s, data, actor, true),
                    "finish" => Finish(s, data, false, false),
                    "reconcile" => Finish(s, data, false, true),
                    "handoff-finish" => Finish(s, data, true, false),
                    "handoff-reconcile" => Finish(s, data, true, true),
                    "import" => Import(s, data),
                    _ => throw new ArgumentException("Unknown inventory command"),
                };
                context["result"] = result.Copy();
                return result;
            }
        );
    }

    // These observations come only from the authenticated PHP adapter, never the browser.
    private static void RefreshNative(JsonObject state, JsonObject data, bool partial = false)
    {
        if (data["native_items"] is not JsonObject observations)
            return;
        foreach (var pair in observations)
        {
            if (partial && !state.Map("items").ContainsKey(pair.Key))
                continue;
            var item = Item(state, pair.Key);
            if (
                item.I("product_lot_id") <= 0
                || item["pending_operation"] is not null
                || item["pending_handoff"] is not null
            )
                continue;
            foreach (
                var key in new[]
                {
                    "warehouse_id",
                    "qty",
                    "bin",
                    "bin_key",
                    "bin_values",
                    "native_batch",
                    "serial",
                    "label",
                    "status",
                }
            )
                if (pair.Value?[key] is not null)
                    item[key] = pair.Value[key].Copy();
        }
    }

    private static JsonNode NativeStage(JsonObject state, JsonObject data, Actor actor)
    {
        Permit(actor.Stock);
        var candidate = (JsonObject)state.DeepClone();
        var fields = (JsonObject)(
            data["fields"] ?? throw new ArgumentException("Missing native fields")
        );
        var action = data.S("action");
        var result = action switch
        {
            "create" => Create(candidate, fields),
            "bulk" => Bulk(candidate, fields),
            "register" => Register(candidate, fields),
            "update" => Edit(candidate, fields),
            "count" => EstablishCount(candidate, fields),
            "box-transfer" => Transfer(candidate, fields),
            _ => throw new ArgumentException("Invalid native command"),
        };
        var changes = new JsonObject();
        if (data.B("link_existing"))
        {
            Require(
                action is "create" or "update" or "register" && fields.S("type") == "tracked",
                "Invalid existing serial link"
            );
            Require(fields.I("qty") is 0 or 1, "A tracked serial must have at most one unit");
            var linkedCode =
                action == "create" ? result!.GetValue<string>()
                : action == "register" ? fields["codes"]![0]!.GetValue<string>()
                : fields.S("code");
            Require(
                state.Map("items")[linkedCode]?.I("product_lot_id") is null or 0,
                "Serial already linked"
            );
            var linked = Item(candidate, linkedCode);
            linked["qty"] = fields.I("qty");
            linked["status"] = fields.I("qty") == 0 ? "consumed" : "in_stock";
        }
        var identities = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in candidate.Map("items"))
        {
            var after = pair.Value!;
            var before = state.Map("items")[pair.Key];
            if (after.S("native_batch") != "")
                Require(
                    identities.Add($"{after.I("product_id")}:{after.S("native_batch")}"),
                    "A Dolibarr lot/serial can belong to only one QR item"
                );
            if (JsonNode.DeepEquals(before, after))
                continue;
            if (before?.I("product_lot_id") > 0)
                Require(
                    before.S("native_batch") == after.S("native_batch"),
                    "The linked Dolibarr lot/serial name cannot be changed here"
                );
            if (after.S("type") is "tracked" or "box")
                Require(
                    after.I("product_id") > 0
                        && after.I("warehouse_id") > 0
                        && after.S("native_batch") != ""
                        && after["qty"] is not null,
                    "Choose a product, warehouse, serial/box name and known quantity"
                );
            changes[pair.Key] = Object(("before", before.Copy()), ("after", after.Copy()));
        }
        var pending = Object(
            ("id", "QRR-N-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(10))),
            ("at", Now),
            ("action", action),
            ("link_existing", data.B("link_existing")),
            ("receive_new_serial", data.B("receive_new_serial")),
            ("changes", changes),
            ("result", result.Copy()),
            ("items", candidate["items"].Copy()),
            ("batches", candidate["batches"].Copy())
        );
        state["pending_native"] = pending;
        return pending.DeepClone();
    }

    private static JsonNode? NativeFinish(JsonObject state, JsonObject data, Actor actor)
    {
        Permit(actor.Stock);
        var pending =
            state["pending_native"]
            ?? throw new InvalidOperationException("No pending native synchronization");
        Require(pending.S("id") == data.S("id"), "Pending native operation changed");
        var items = (JsonObject)pending["items"]!.DeepClone();
        foreach (var pair in (JsonObject)pending["changes"]!)
        {
            if (pair.Value!["after"].S("native_batch") == "")
                continue;
            var id = data["bindings"]?.I(pair.Key) ?? 0;
            Require(id > 0, "Missing native lot/serial receipt");
            items[pair.Key]!["product_lot_id"] = id;
        }
        state["items"] = items;
        state["batches"] = pending["batches"].Copy();
        var result = pending["result"].Copy();
        state.Remove("pending_native");
        return result;
    }

    private static JsonNode? NativeCancel(JsonObject state, JsonObject data, Actor actor)
    {
        Permit(actor.Stock);
        var pending =
            state["pending_native"]
            ?? throw new InvalidOperationException("No pending native synchronization");
        Require(
            pending.S("id") == data.S("id") && data.B("cancelled_receipt"),
            "Missing native cancellation receipt"
        );
        Require(
            DateTimeOffset.TryParse(pending.S("at"), out var at)
                && DateTimeOffset.UtcNow - at >= TimeSpan.FromSeconds(30),
            "Synchronization may still be running"
        );
        state.Remove("pending_native");
        return null;
    }

    private static JsonObject AuditContext(JsonObject data)
    {
        var context = new JsonObject();
        foreach (
            var key in new[]
            {
                "code",
                "kind",
                "id",
                "from",
                "to",
                "quantity",
                "reason",
                "user_id",
                "warehouse_id",
                "count",
                "args",
                "product_id",
                "type",
                "label",
                "qty",
                "choice",
                "serial",
                "details",
                "native_batch",
                "prefs",
                "codes",
            }
        )
            if (data.ContainsKey(key))
                context[key] = data[key].Copy();
        return context;
    }

    private static JsonObject Item(JsonObject state, string code)
    {
        Require(Codes.Valid(code), "Invalid QR identifier");
        return state.Map("items")[code] as JsonObject
            ?? throw new KeyNotFoundException("Unknown QR identifier");
    }

    private static bool Available(JsonNode item) =>
        item.S("type") != "unassigned"
        && item.S("status") != "consumed"
        && item["checkout"] is null
        && item["pending_handoff"] is null
        && item["pending_operation"] is null;

    private static int Units(JsonNode item)
    {
        Require(
            item.S("type") != "unassigned"
                && item.S("status") != "consumed"
                && item["pending_operation"] is null,
            "Item consumed, unassigned or pending"
        );
        var qty = item.S("type") == "box" ? item.I("qty", -1) : 1;
        Require(qty > 0, "Count this container first");
        return qty;
    }

    private static void Warehouse(JsonNode data, int id) =>
        Require(
            id > 0 && data["warehouses"]?[id.ToString()] is not null,
            "Warehouse is unavailable"
        );

    private static string Text(JsonNode data, string key, int max)
    {
        var value = data.S(key).Trim();
        Require(
            System.Text.Encoding.UTF8.GetByteCount(value) <= max && !value.Contains('\0'),
            $"Invalid or too long {key}"
        );
        return value;
    }

    private static JsonObject Choice(JsonNode data)
    {
        var choice = data["choice"] as JsonObject ?? new JsonObject();
        var bin = Text(choice, "bin", 100);
        Require(!bin.Any(c => char.IsControl(c) || c is '<' or '>'), "Invalid bin code");
        return Object(
            ("bin", bin),
            ("bin_key", choice.S("bin_key")),
            ("bin_values", choice["bin_values"].Copy() ?? new JsonObject())
        );
    }

    private static JsonObject Make(JsonObject data, string code)
    {
        var type = data.S("type", "unassigned");
        Require(
            new[] { "unassigned", "tracked", "generic", "box" }.Contains(type),
            "Invalid item type"
        );
        var pid = data.I("product_id");
        var wid = data.I("warehouse_id");
        var choice = Choice(data);
        var label = Text(data, "label", 140);
        var details = Text(data, "details", 2000);
        var serial = Text(data, "serial", 100);
        var batch = Text(data, "native_batch", 100);
        int? qty =
            type == "unassigned" ? 0
            : type == "box" ? data["qty"]?.GetValue<int>()
            : 1;
        Require(pid >= 0 && wid >= 0, "Invalid product or warehouse");
        if (type == "unassigned")
            Require(
                pid == 0
                    && wid == 0
                    && label == ""
                    && choice.S("bin") == ""
                    && details == ""
                    && serial == ""
                    && batch == "",
                "Unassigned labels cannot contain inventory data"
            );
        else
        {
            if (wid != 0)
                Warehouse(data, wid);
            Require(choice.S("bin") == "" || wid > 0, "Choose a warehouse before a bin");
            Require(qty is null || qty is >= 0 and <= 100000000, "Invalid container quantity");
            Require(
                type == "tracked"
                    || (details == "" && serial == "" && (type == "box" || batch == "")),
                "Only tracked items may have serial/details; lots belong to tracked items or boxes"
            );
        }
        var item = Object(
            ("code", code),
            ("type", type),
            ("label", label),
            ("product_id", pid),
            ("warehouse_id", wid),
            ("qty", qty),
            ("details", details),
            ("serial", serial),
            ("native_batch", batch),
            ("status", type == "unassigned" ? "unassigned" : "in_stock"),
            ("consumed_units", 0),
            ("created_at", Now),
            ("updated_at", Now)
        );
        foreach (var p in choice)
            item[p.Key] = p.Value.Copy();
        return item;
    }

    private static string Unique(JsonObject state)
    {
        string code;
        do
        {
            code = Codes.New();
        } while (state.Map("items").ContainsKey(code));
        return code;
    }

    private static JsonNode Create(JsonObject state, JsonObject data)
    {
        var code = Unique(state);
        state.Map("items")[code] = Make(data, code);
        return JsonValue.Create(code)!;
    }

    private static JsonNode? DeleteUnassigned(JsonObject state, JsonObject data)
    {
        var code = data.S("code");
        var item = Item(state, code);
        Require(
            item.S("type") == "unassigned"
                && item.I("product_id") == 0
                && item.I("warehouse_id") == 0
                && item.I("product_lot_id") == 0
                && item.S("serial") == ""
                && item.S("native_batch") == ""
                && item.I("qty") == 0
                && item.I("consumed_units") == 0
                && item["checkout"] is null
                && item["pending_operation"] is null
                && item["pending_handoff"] is null,
            "Only unassigned QR codes without inventory or pending operations can be deleted"
        );
        state.Map("items").Remove(code);
        foreach (var pair in state.Map("batches").ToArray())
        {
            if (pair.Value?["codes"] is not JsonArray codes)
                continue;
            for (var i = codes.Count - 1; i >= 0; i--)
                if (codes[i]?.GetValue<string>() == code)
                    codes.RemoveAt(i);
            if (codes.Count == 0)
                state.Map("batches").Remove(pair.Key);
        }
        return null;
    }

    private static JsonNode Bulk(JsonObject state, JsonObject data)
    {
        var count = data.I("count");
        Require(count is >= 1 and <= 200, "Batch size must be between 1 and 200");
        var entries = data["entries"] as JsonArray;
        Require(entries is null || entries.Count == count, "Invalid batch entry count");
        if (data.S("type") is "tracked" or "box")
            Require(
                entries?.Count == count,
                "Bulk native items require a distinct identity for every label"
            );
        var codes = new JsonArray();
        for (var i = 0; i < count; i++)
        {
            var fields = entries is null ? data : entries[i] as JsonObject;
            Require(
                fields is not null
                    && fields.S("type", "unassigned") == data.S("type", "unassigned"),
                "Invalid batch entry"
            );
            codes.Add(Create(state, fields!).GetValue<string>());
        }
        string id;
        do
        {
            id = Convert.ToHexString(RandomNumberGenerator.GetBytes(6));
        } while (state.Map("batches").ContainsKey(id));
        state.Map("batches")[id] = Object(
            ("created_at", Now),
            ("codes", codes),
            ("type", data.S("type", "unassigned"))
        );
        return JsonValue.Create(id)!;
    }

    private static JsonNode Register(JsonObject state, JsonObject data)
    {
        var codes =
            data["codes"] as JsonArray ?? throw new ArgumentException("Expected scanned codes");
        Require(codes.Count is >= 1 and <= 200, "Scan between 1 and 200 labels");
        var type = data.S("type");
        Require(type is "tracked" or "generic" or "box", "Invalid registration type");
        Require(
            type == "generic" || codes.Count == 1,
            "Tracked items and containers require one label"
        );
        Require(
            data.I("product_id") > 0
                && data.I("warehouse_id") > 0
                && (type != "box" || data["qty"] is not null),
            "Registration needs a product, warehouse and known container quantity"
        );
        var seen = new HashSet<string>();
        foreach (var node in codes)
        {
            var code = node!.GetValue<string>();
            Require(
                seen.Add(code) && Item(state, code).S("type") == "unassigned",
                "Label is duplicated or already assigned"
            );
            var item = Make(data, code);
            item["created_at"] = Item(state, code)["created_at"].Copy();
            item["registered_at"] = Now;
            state.Map("items")[code] = item;
        }
        return codes.DeepClone();
    }

    private static JsonNode? Edit(JsonObject state, JsonObject data)
    {
        var item = Item(state, data.S("code"));
        Require(
            Available(item)
                || (
                    item.S("type") == "unassigned"
                    && item["pending_operation"] is null
                    && item["pending_handoff"] is null
                ),
            "Return or reconcile before editing"
        );
        var fresh = Make(data, data.S("code"));
        if (item.S("type") != "unassigned")
        {
            Require(
                item.S("type") == fresh.S("type") && item.I("product_id") == fresh.I("product_id"),
                "Cannot change stocked item type or product"
            );
            Require(
                item.I("product_id") == 0
                    || item.I("warehouse_id") == 0
                    || item.I("warehouse_id") == fresh.I("warehouse_id"),
                "Use a warehouse transfer"
            );
            Require(
                item.S("type") != "box" || JsonNode.DeepEquals(item["qty"], fresh["qty"]),
                "Use stock correction to change quantity"
            );
            fresh.Remove("status");
            fresh.Remove("consumed_units");
        }
        fresh.Remove("created_at");
        foreach (var p in fresh)
            item[p.Key] = p.Value.Copy();
        return null;
    }

    private static JsonNode? EstablishCount(JsonObject state, JsonObject data)
    {
        var item = Item(state, data.S("code"));
        var qty = data.I("quantity", -1);
        Require(
            Available(item)
                && item.S("type") == "box"
                && item["qty"] is null
                && qty is >= 0 and <= 100000000,
            "Container state changed or invalid count"
        );
        item["qty"] = qty;
        item["updated_at"] = Now;
        return null;
    }

    private static JsonNode? Transfer(JsonObject state, JsonObject data)
    {
        var a = Item(state, data.S("from"));
        var b = Item(state, data.S("to"));
        var n = data.I("quantity");
        Require(
            !ReferenceEquals(a, b)
                && Available(a)
                && Available(b)
                && a.S("type") == "box"
                && b.S("type") == "box",
            "Two available containers required"
        );
        Require(
            a.I("product_id") > 0
                && a.I("product_id") == b.I("product_id")
                && a.I("warehouse_id") > 0
                && a.I("warehouse_id") == b.I("warehouse_id"),
            "Containers must share a product and warehouse"
        );
        Require(
            n > 0
                && a.I("qty", -1) >= n
                && b.I("qty", -1) >= 0
                && (long)b.I("qty") + n <= 100000000,
            "Invalid or unknown quantity"
        );
        a["qty"] = a.I("qty") - n;
        b["qty"] = b.I("qty") + n;
        var at = Now;
        a["updated_at"] = at;
        b["updated_at"] = at;
        return null;
    }

    private static JsonNode? Mapping(JsonObject state, JsonObject data)
    {
        var uid = data.I("user_id");
        var wid = data.I("warehouse_id");
        Require(uid > 0 && data["users"]?[uid.ToString()] is not null, "Choose an active employee");
        if (wid != 0)
            Warehouse(data, wid);
        foreach (var pair in state.Map("items"))
            Require(
                pair.Value?["pending_handoff"] is null
                    && pair.Value?["checkout"]?.I("user_id") != uid,
                "Resolve handoffs and return employee loans before changing mapping"
            );
        foreach (var pair in state.Map("personal_warehouses"))
            Require(
                pair.Key == uid.ToString() || wid == 0 || pair.Value!.GetValue<int>() != wid,
                "Warehouse belongs to another employee"
            );
        if (data.B("resolve"))
            Require(
                state.Map("personal_warehouses")[uid.ToString()] is null,
                "Personal mapping changed; refresh"
            );
        if (wid == 0)
            state.Map("personal_warehouses").Remove(uid.ToString());
        else
            state.Map("personal_warehouses")[uid.ToString()] = wid;
        return null;
    }

    private static JsonNode? LabelSettings(JsonObject state, JsonObject data)
    {
        var wid = data.I("warehouse_id");
        Warehouse(data, wid);
        var prefs =
            data["prefs"] as JsonObject ?? throw new ArgumentException("Missing label preferences");
        Require(
            prefs["show"] is JsonObject { Count: > 0 },
            "At least one location level must be shown"
        );
        var ids = Locations
            .Levels(state, wid)
            .Select(level => level!.I("id").ToString())
            .ToHashSet();
        foreach (var pair in (JsonObject)prefs["show"]!)
            Require(
                ids.Contains(pair.Key) && pair.Value?.ToJsonString() is "1" or "true",
                "Invalid visible location level"
            );
        Require(prefs["separator"] is null or JsonObject, "Invalid label separators");
        if (prefs["separator"] is JsonObject separators)
            foreach (var pair in separators)
            {
                Require(ids.Contains(pair.Key), "Unknown location separator level");
                Require(
                    pair.Value is JsonValue value && value.TryGetValue<string>(out _),
                    "Invalid label separator"
                );
                var text = pair.Value!.GetValue<string>();
                Require(
                    System.Text.Encoding.UTF8.GetByteCount(text) <= 12
                        && !text.Any(c => char.IsControl(c) || c is '<' or '>'),
                    "Invalid label separator"
                );
            }
        state.Map("location_label_settings")[wid.ToString()] = prefs.DeepClone();
        return null;
    }

    private static JsonObject Plan(JsonObject state, JsonObject data, Actor actor, bool handoff)
    {
        var item = Item(state, data.S("code"));
        var kind = data.S("kind");
        var args = data["args"] as JsonObject ?? new JsonObject();
        var from = item.I("warehouse_id");
        var pid = item.I("product_id");
        var qty = item.S("type") == "box" ? item.I("qty", -1) : 1;
        var effects = new JsonArray();
        var patch = new JsonObject();
        var reason = Text(args, "reason", 200);
        var op = Object(
            ("kind", kind),
            ("product_lot_id", item.I("product_lot_id")),
            ("native_batch", item.S("native_batch")),
            ("product_id", pid),
            ("reason", reason),
            ("reference_type", args.S("reference_type")),
            ("reference_id", args.I("reference_id")),
            ("amount", args.I("quantity")),
            ("revision", state.I("revision"))
        );
        void Effect(int wid, int delta)
        {
            if (delta != 0)
                effects.Add(Object(("warehouse_id", wid), ("delta", delta)));
        }
        void Location(int to)
        {
            Warehouse(data, to);
            patch["warehouse_id"] = to;
            foreach (var p in Choice(args))
                patch[p.Key] = p.Value.Copy();
        }
        if (handoff)
        {
            Permit(actor.Stock);
            Require(kind is "checkout" or "checkin", "Invalid handoff type");
            Require(item["pending_handoff"] is null, "Reconcile pending handoff first");
            qty = Units(item);
            var person = args.I("person_id");
            var loan = item["checkout"];
            Require(
                kind == "checkout"
                    ? loan is null && data["users"]?[person.ToString()] is not null
                    : loan is not null && loan.I("user_id") == person,
                "Borrower does not match or item already on loan"
            );
            var personal =
                state.Map("personal_warehouses")[person.ToString()]?.GetValue<int>() ?? 0;
            Warehouse(data, personal);
            var to = kind == "checkout" ? personal : loan!.I("origin_warehouse_id");
            Require(kind != "checkin" || from == personal, "Item is outside employee warehouse");
            Require(from != to && pid > 0, "Invalid stock transfer");
            Warehouse(data, from);
            Warehouse(data, to);
            op["person_id"] = person;
            op["from"] = from;
            op["to"] = to;
            op["qty"] = qty;
            op["location_target"] =
                kind == "checkout"
                    ? Object(("warehouse_id", to), ("bin_values", new JsonObject()))
                    : Object(
                        ("warehouse_id", to),
                        ("bin_values", loan!["origin_bin_values"].Copy() ?? new JsonObject())
                    );
            Effect(from, -qty);
            Effect(to, qty);
        }
        else if (kind == "return")
        {
            Require(
                item.S("type") != "unassigned"
                    && item["checkout"] is null
                    && item["pending_operation"] is null
                    && item["pending_handoff"] is null,
                "Item unavailable for return"
            );
            var outstanding = item.I("consumed_units");
            var n = args.I("quantity");
            var to = args.I("warehouse_id");
            Require(
                item.S("status") == "consumed" || outstanding > 0,
                "No recorded consumption to return"
            );
            Require(
                n > 0
                    && (outstanding == 0 || n <= outstanding)
                    && (item.S("type") == "box" || n == 1),
                "Invalid return quantity"
            );
            Require(
                pid > 0 && (item.S("type") != "box" || qty <= 0 || from == to),
                "Return a partly consumed container to its current warehouse"
            );
            if (item.S("type") == "box")
            {
                Require(qty >= 0 && (long)qty + n <= 100000000, "Invalid container quantity");
                patch["qty"] = qty + n;
            }
            Location(to);
            patch["status"] = "in_stock";
            patch["consumed_units"] = Math.Max(0, outstanding - n);
            Require(
                item.I("product_lot_id") == 0 || args.B("post_stock"),
                "Native-linked items require native stock posting; refresh to see adjustments made directly in Dolibarr"
            );
            if (args.B("post_stock"))
                Effect(to, n);
        }
        else
        {
            Require(Available(item), "Item is unassigned, consumed, checked out or pending");
            switch (kind)
            {
                case "move":
                    var to = args.I("warehouse_id");
                    Location(to);
                    if (from != to && !(item.S("type") == "box" && qty == 0))
                    {
                        Require(
                            from > 0 && pid > 0 && qty > 0,
                            "Transfer requires a product and known positive quantity"
                        );
                        Effect(from, -qty);
                        Effect(to, qty);
                    }
                    break;
                case "consume":
                    var n = args.I("quantity");
                    Require(
                        pid > 0
                            && from > 0
                            && qty > 0
                            && n > 0
                            && n <= qty
                            && (item.S("type") == "box" || n == 1),
                        "Invalid consumption quantity"
                    );
                    patch["status"] = qty == n ? "consumed" : "in_stock";
                    patch["consumed_units"] = checked(item.I("consumed_units") + n);
                    if (item.S("type") == "box")
                        patch["qty"] = qty - n;
                    if (qty == n)
                        patch["consumed_at"] = Now;
                    Require(
                        item.I("product_lot_id") == 0 || args.B("post_stock"),
                        "Native-linked items require native stock posting; refresh to see adjustments made directly in Dolibarr"
                    );
                    if (args.B("post_stock"))
                        Effect(from, -n);
                    break;
                case "correct":
                    var count = args.I("quantity", -1);
                    Require(
                        item.S("type") == "box" && qty >= 0 && count is >= 0 and <= 100000000,
                        "Count container before stock correction"
                    );
                    if (count != qty)
                    {
                        Require(
                            pid > 0 && from > 0,
                            "Correction requires linked product and warehouse"
                        );
                        Effect(from, count - qty);
                    }
                    patch["qty"] = count;
                    break;
                default:
                    throw new ArgumentException("Unknown inventory action");
            }
        }
        if (effects.Count > 0)
        {
            Permit(actor.Stock);
            foreach (var effect in effects)
                Warehouse(data, effect!.I("warehouse_id"));
        }
        if (
            !handoff
            && item.I("product_lot_id") > 0
            && (
                kind == "move"
                || (
                    patch.S("status", item.S("status")) != "consumed"
                    && (item.S("type") != "box" || patch.I("qty", item.I("qty")) > 0)
                )
            )
        )
            op["location_target"] = Object(
                ("warehouse_id", patch.I("warehouse_id", from)),
                (
                    "bin_values",
                    patch["bin_values"].Copy() ?? item["bin_values"].Copy() ?? new JsonObject()
                )
            );
        op["effects"] = effects;
        op["patch"] = patch;
        return op;
    }

    private static JsonNode Stage(JsonObject state, JsonObject data, Actor actor, bool handoff)
    {
        Require(
            data.I("revision", -1) == state.I("revision"),
            "Inventory changed during preflight; refresh before retrying"
        );
        var op = Plan(state, data, actor, handoff);
        op.Remove("revision");
        var effects = (JsonArray)op["effects"]!;
        op["id"] =
            effects.Count == 0 && op.I("product_lot_id") == 0
                ? ""
                : "QRR-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(10));
        op["at"] = Now;
        var item = Item(state, data.S("code"));
        if (handoff)
        {
            op["inventorycode"] = op.S("id");
            item["pending_handoff"] = op.DeepClone();
        }
        else if (effects.Count > 0 || op.I("product_lot_id") > 0)
            item["pending_operation"] = op.DeepClone();
        else
            Apply(item, op);
        return op;
    }

    private static void Apply(JsonObject item, JsonObject op)
    {
        foreach (var p in (JsonObject)op["patch"]!)
            item[p.Key] = p.Value.Copy();
        item["updated_at"] = Now;
        if (op.S("kind") is "consume" or "return")
        {
            if (item["consumption_log"] is null)
                item["consumption_log"] = new JsonArray();
            ((JsonArray)item["consumption_log"]!).Add(
                Object(
                    ("at", Now),
                    ("kind", op.S("kind")),
                    ("quantity", op.I("amount")),
                    ("reason", op.S("reason")),
                    ("reference_type", op.S("reference_type")),
                    ("reference_id", op.I("reference_id")),
                    ("stock_posted", ((JsonArray)op["effects"]!).Count > 0),
                    ("inventorycode", op.S("id"))
                )
            );
        }
    }

    private static JsonNode Finish(JsonObject state, JsonObject data, bool handoff, bool reconcile)
    {
        var item = Item(state, data.S("code"));
        var key = handoff ? "pending_handoff" : "pending_operation";
        var op =
            item[key] as JsonObject ?? throw new InvalidOperationException("No pending operation");
        Require(op.S("id") == data.S("id"), "Pending operation changed");
        if (reconcile)
            Require(
                DateTimeOffset.TryParse(op.S("at"), out var at)
                    && DateTimeOffset.UtcNow - at >= TimeSpan.FromSeconds(30),
                "Operation may still be running; wait before reconciliation"
            );
        var proof =
            data["proof"] ?? throw new ArgumentException("Missing native movement evidence");
        var counts = handoff
            ? new[] { proof.I("out"), proof.I("in") }
            : (proof["seen"] as JsonArray ?? throw new ArgumentException("Missing effect evidence"))
                .Select(n => n!.GetValue<int>())
                .ToArray();
        Require(
            counts.Length == (handoff ? 2 : ((JsonArray)op["effects"]!).Count),
            "Movement evidence length mismatch"
        );
        Require(
            proof[handoff ? "extra" : "other"] is not null,
            "Missing conflicting-movement count"
        );
        var complete = proof.I(handoff ? "extra" : "other") == 0 && counts.All(n => n == 1);
        var none = proof.I(handoff ? "extra" : "other") == 0 && counts.All(n => n == 0);
        Require(
            complete || (reconcile && none),
            "Partial/conflicting native movements; investigate stock history"
        );
        if (complete)
        {
            if (!handoff)
                Apply(item, op);
            else
            {
                if (op.S("kind") == "checkout")
                {
                    item["checkout"] = Object(
                        ("user_id", op.I("person_id")),
                        ("reason", op.S("reason")),
                        ("at", Now),
                        ("origin_warehouse_id", op.I("from")),
                        ("origin_bin", item.S("bin")),
                        ("origin_bin_key", item.S("bin_key")),
                        ("origin_bin_values", item["bin_values"].Copy() ?? new JsonObject())
                    );
                    item["bin"] = "";
                    item["bin_key"] = "";
                    item["bin_values"] = new JsonObject();
                }
                else
                {
                    var loan =
                        item["checkout"]
                        ?? throw new InvalidOperationException("Loan data missing");
                    item["bin"] = loan.S("origin_bin");
                    item["bin_key"] = loan.S("origin_bin_key");
                    item["bin_values"] = loan["origin_bin_values"].Copy();
                    item.Remove("checkout");
                }
                item["warehouse_id"] = op.I("to");
                item["updated_at"] = Now;
            }
        }
        item.Remove(key);
        return JsonValue.Create(
            complete
                ? "Completed from native stock evidence"
                : "Cancelled pending operation: no native stock movements found"
        )!;
    }

    private static JsonNode? Import(JsonObject state, JsonObject data)
    {
        Require(
            state.I("revision") == 0 && state.Map("items").Count == 0,
            "Import is allowed only into a new entity store"
        );
        var imported = data["state"] as JsonObject ?? throw new ArgumentException("Missing state");
        StateRepository.Validate(imported);
        foreach (var pair in imported)
            state[pair.Key] = pair.Value.Copy();
        return null;
    }
}
