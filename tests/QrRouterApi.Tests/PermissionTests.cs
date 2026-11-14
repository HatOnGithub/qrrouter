using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using QrRouterApi.DTO;
using QrRouterApi.Helpers;
using QrRouterApi.Repositories;
using QrRouterApi.Services;
using static QrRouterApi.Helpers.Json;

internal static class PermissionTests
{
    public static int Run(string directory)
    {
        var service = new InventoryService(
            new StateRepository(Options.Create(new AppSettings { DataDirectory = directory }))
        );
        var reader = new Actor(95, 17, true, false, false, false, Use: true, Permissions: []);
        var checks = 0;
        void Check(bool valid, string message)
        {
            if (!valid)
                throw new Exception(message);
            checks++;
        }
        void Denied(Action action)
        {
            try
            {
                action();
            }
            catch (UnauthorizedAccessException)
            {
                checks++;
                return;
            }
            throw new Exception("Expected permission denial");
        }
        JsonObject State() => service.State(reader, false);
        var create = reader with { Permissions = ["create"] };
        var modify = reader with { Permissions = ["modify"] };
        var delete = reader with { Permissions = ["delete"] };
        Check(State().Map("items").Count == 0, "Read-only module access works without manage");
        Denied(() => service.State(reader with { Use = false }, false));
        Denied(() => service.State(reader with { Read = false }, false));
        Denied(() => service.Execute(reader with { Manage = true }, "bulk", Object(("count", 1))));
        var batch = service.Execute(create, "bulk", Object(("count", 1)))!.GetValue<string>();
        var blank = State()["batches"]![batch]!["codes"]![0]!.GetValue<string>();
        Denied(() => service.Execute(create, "delete-unassigned", Object(("code", blank))));
        var fields = Object(
            ("type", "generic"),
            ("label", "Permission unit"),
            ("product_id", 4),
            ("warehouse_id", 1),
            ("qty", 1),
            ("warehouses", Object(("1", new { }), ("2", new { })))
        );
        var code = service.Execute(create, "create", fields)!.GetValue<string>();
        var update = (JsonObject)fields.DeepClone();
        update["code"] = code;
        update["label"] = "Changed";
        service.Execute(modify, "update", update);
        Check(
            State()["items"]![code].S("label") == "Changed",
            "Modify-only user can edit an existing item"
        );
        Denied(() => service.Execute(modify, "create", fields));
        update["code"] = blank;
        Denied(() => service.Execute(modify, "update", update));
        Denied(() =>
            service.Execute(
                modify,
                "native-stage",
                Object(("action", "create"), ("fields", fields))
            )
        );
        service.Execute(delete, "delete-unassigned", Object(("code", blank)));
        Check(State()["items"]![blank] is null, "Delete-only user can remove an unused label");
        Denied(() => service.Execute(delete, "update", update));
        var mover = reader with { Stock = true, Permissions = ["move"] };
        var movement = Object(
            ("code", code),
            ("kind", "move"),
            ("args", Object(("warehouse_id", 2))),
            ("warehouses", Object(("1", new { }), ("2", new { })))
        );
        Denied(() => service.Execute(create, "plan", movement));
        Denied(() => service.Execute(mover with { Stock = false }, "plan", movement));
        var plan = service.Execute(mover, "plan", movement)!;
        movement["revision"] = plan.I("revision");
        var pending = service.Execute(mover, "stage", movement)!;
        var finish = Object(
            ("code", code),
            ("id", pending.S("id")),
            ("proof", Object(("seen", new[] { 1, 1 }), ("other", 0)))
        );
        Denied(() => service.Execute(mover with { Permissions = ["consume"] }, "finish", finish));
        Denied(() => service.Execute(mover with { Use = false }, "finish", finish));
        service.Execute(mover, "finish", finish);
        Check(
            State()["items"]![code].I("warehouse_id") == 2,
            "Finishing rechecks the stored operation's own capability"
        );
        Denied(() =>
            service.Execute(reader with { History = true }, "query-history", new JsonObject())
        );
        Denied(() => service.State(reader, true));
        return checks;
    }
}
