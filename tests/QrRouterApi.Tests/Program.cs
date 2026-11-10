using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using QrRouterApi.DTO;
using QrRouterApi.Helpers;
using QrRouterApi.Repositories;
using QrRouterApi.Services;
using static QrRouterApi.Helpers.Json;

var directory = Path.Combine(Path.GetTempPath(), "qrrouter-tests-" + Guid.NewGuid().ToString("N"));
var repository = new StateRepository(Options.Create(new AppSettings { DataDirectory = directory }));
var service = new InventoryService(repository);
var admin = new Actor(1, 7, true, true, true, true);
var passed = 0;
void Check(bool condition, string message)
{
    if (!condition)
        throw new Exception(message);
    passed++;
}
void Reject(Action action, string message)
{
    try
    {
        action();
    }
    catch (Exception e)
        when (e
                is InvalidOperationException
                    or UnauthorizedAccessException
                    or ArgumentException
                    or InvalidDataException
        )
    {
        passed++;
        return;
    }
    throw new Exception("Expected rejection: " + message);
}
Check(!new AppSettings().HasPersistentDataDirectory(), "Explicit persistent directory is required");
Check(
    !new AppSettings { DataDirectory = "data" }.HasPersistentDataDirectory(),
    "Relative data paths rejected"
);
Check(
    !new AppSettings { DataDirectory = AppContext.BaseDirectory }.HasPersistentDataDirectory(),
    "Application directory rejected"
);
Check(
    !new AppSettings
    {
        DataDirectory = Path.Combine(AppContext.BaseDirectory, "data"),
    }.HasPersistentDataDirectory(),
    "Application child directory rejected"
);
Check(
    new AppSettings { DataDirectory = directory }.HasPersistentDataDirectory(),
    "External persistent directory accepted"
);
Check(
    new AppSettings
    {
        DataDirectory = Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory) + "-data",
    }.HasPersistentDataDirectory(),
    "Sibling directory accepted"
);
JsonObject Warehouses() => Object(("1", new { }), ("2", new { }), ("3", new { }));
JsonObject Fields(string type = "box", int? qty = 10) =>
    Object(
        ("type", type),
        ("label", "Spare parts"),
        ("product_id", 4),
        ("warehouse_id", 1),
        ("qty", qty),
        (
            "choice",
            new
            {
                bin = "A-2",
                bin_key = "1:2",
                bin_values = new { level = 2 },
            }
        ),
        ("warehouses", Warehouses())
    );
JsonNode? Cmd(string action, JsonObject data) => service.Execute(admin, action, data);
JsonObject State() => service.State(admin);
JsonObject GetItem(string code) => (JsonObject)State()["items"]![code]!;
JsonObject PlanData(string code, string kind, JsonObject args) =>
    Object(("code", code), ("kind", kind), ("args", args), ("warehouses", Warehouses()));
JsonObject Stage(JsonObject data, bool handoff = false)
{
    var plan = (JsonObject)Cmd(handoff ? "handoff-plan" : "plan", data)!;
    data["revision"] = plan.I("revision");
    return (JsonObject)Cmd(handoff ? "handoff-stage" : "stage", data)!;
}
void Finish(string code, JsonObject op, bool handoff = false)
{
    var proof = handoff
        ? Object(("out", 1), ("in", 1), ("extra", 0))
        : Object(("seen", ((JsonArray)op["effects"]!).Select(_ => 1).ToArray()), ("other", 0));
    Cmd(
        handoff ? "handoff-finish" : "finish",
        Object(("code", code), ("id", op.S("id")), ("proof", proof))
    );
}
try
{
    // Exhaust every possible single-symbol change and adjacent unequal swap for generated labels.
    for (var i = 0; i < 30; i++)
    {
        var code = Codes.New();
        Check(Codes.Valid(code), "Generated checksum");
        for (var pos = 0; pos < code.Length; pos++)
            foreach (var symbol in Codes.Alphabet.Where(c => c != code[pos]))
            {
                var changed = code.ToCharArray();
                changed[pos] = symbol;
                Check(!Codes.Valid(new string(changed)), "Single-symbol error detection");
            }
        for (var pos = 0; pos < 4; pos++)
            if (code[pos] != code[pos + 1])
            {
                var changed = code.ToCharArray();
                (changed[pos], changed[pos + 1]) = (changed[pos + 1], changed[pos]);
                Check(!Codes.Valid(new string(changed)), "Adjacent swap detection");
            }
    }
    Reject(
        () => service.State(admin with { Read = false, Manage = false, Admin = false }),
        "Read permission"
    );
    Reject(
        () =>
            service.Execute(
                admin with
                {
                    Manage = false,
                    Admin = false,
                },
                "bulk",
                Object(("count", 1))
            ),
        "Write permission"
    );
    Check(service.State(admin with { EntityId = 2 }).Map("items").Count == 0, "Entity isolation");
    var batch = Cmd("bulk", Object(("count", 3)))!.GetValue<string>();
    var codes = (JsonArray)State()["batches"]![batch]!["codes"]!;
    var code1 = codes[0]!.GetValue<string>();
    var code2 = codes[1]!.GetValue<string>();
    var registration = Fields();
    registration["codes"] = new JsonArray(code1);
    Cmd("register", registration);
    Check(
        GetItem(code1).I("qty") == 10 && GetItem(code1).S("type") == "box",
        "Metadata registration"
    );
    var rev = State().I("revision");
    Reject(() => Cmd("register", registration), "Double registration");
    Check(State().I("revision") == rev, "Failed mutation leaves revision unchanged");
    var duplicates = Fields("generic");
    duplicates["codes"] = new JsonArray(code2, code2);
    Reject(() => Cmd("register", duplicates), "Duplicate registration rolls back entire set");
    Check(GetItem(code2).S("type") == "unassigned", "Atomic registration rollback");
    Reject(() => Cmd("bulk", Object(("count", 201))), "Batch cap");
    var stale = PlanData(code1, "move", Object(("warehouse_id", 2)));
    stale["revision"] = ((JsonObject)Cmd("plan", stale)!).I("revision");
    Cmd("bulk", Object(("count", 1)));
    Reject(() => Cmd("stage", stale), "Concurrent preflight revision");
    var move = Stage(
        PlanData(code1, "move", Object(("warehouse_id", 2), ("choice", new { bin = "B1" })))
    );
    Check(
        GetItem(code1).I("warehouse_id") == 1 && GetItem(code1)["pending_operation"] is not null,
        "Stage before native stock commit"
    );
    Reject(() => Cmd("update", Fields()), "Invalid metadata edit");
    Reject(
        () => Stage(PlanData(code1, "consume", Object(("quantity", 1)))),
        "Pending operation blocks second action"
    );
    Reject(
        () =>
            Cmd(
                "finish",
                Object(
                    ("code", code1),
                    ("id", move.S("id")),
                    ("proof", new { seen = new[] { 1, 0 }, other = 0 })
                )
            ),
        "Partial stock movement"
    );
    Reject(
        () =>
            Cmd(
                "finish",
                Object(
                    ("code", code1),
                    ("id", "wrong"),
                    ("proof", new { seen = new[] { 1, 1 }, other = 0 })
                )
            ),
        "Wrong operation identity"
    );
    Reject(
        () =>
            Cmd(
                "reconcile",
                Object(
                    ("code", code1),
                    ("id", move.S("id")),
                    ("proof", new { seen = new[] { 0, 0 }, other = 0 })
                )
            ),
        "Recent reconciliation"
    );
    Finish(code1, move);
    Check(
        GetItem(code1).I("warehouse_id") == 2 && GetItem(code1)["pending_operation"] is null,
        "Native evidence finalizes transfer"
    );
    Reject(() => Finish(code1, move), "Repeated completion");
    var consume = Stage(PlanData(code1, "consume", Object(("quantity", 4), ("post_stock", true))));
    var reopened = new InventoryService(
        new StateRepository(Options.Create(new AppSettings { DataDirectory = directory }))
    );
    Check(
        reopened.State(admin)["items"]![code1]!["pending_operation"]!.S("id") == consume.S("id"),
        "Crash recovery reloads pending state"
    );
    Finish(code1, consume);
    Check(
        GetItem(code1).I("qty") == 6 && GetItem(code1).I("consumed_units") == 4,
        "Partial consumption"
    );
    Reject(
        () => Stage(PlanData(code1, "return", Object(("quantity", 1), ("warehouse_id", 1)))),
        "Partial container return warehouse"
    );
    var returned = Stage(
        PlanData(
            code1,
            "return",
            Object(("quantity", 2), ("warehouse_id", 2), ("post_stock", false))
        )
    );
    Check(
        ((JsonArray)returned["effects"]!).Count == 0
            && GetItem(code1).I("qty") == 8
            && GetItem(code1).I("consumed_units") == 2,
        "Already-posted stock return"
    );
    var correction = Stage(PlanData(code1, "correct", Object(("quantity", 7))));
    Finish(code1, correction);
    Check(
        GetItem(code1).I("qty") == 7 && GetItem(code1).I("consumed_units") == 2,
        "Correction preserves consumed units"
    );
    var unknown = Cmd("create", Fields("box", null))!.GetValue<string>();
    Reject(
        () => Stage(PlanData(unknown, "correct", Object(("quantity", 3)))),
        "Unknown count cannot create native delta"
    );
    Cmd("count", Object(("code", unknown), ("quantity", 3)));
    var box = Cmd("create", Fields("box", 2))!.GetValue<string>();
    Cmd("box-transfer", Object(("from", unknown), ("to", box), ("quantity", 2)));
    Check(
        GetItem(unknown).I("qty") == 1 && GetItem(box).I("qty") == 4,
        "Container content transfer"
    );
    Reject(
        () => Cmd("box-transfer", Object(("from", box), ("to", box), ("quantity", 1))),
        "Self transfer"
    );
    var edit = Fields("box", 99);
    edit["code"] = box;
    Reject(() => Cmd("update", edit), "Metadata cannot alter quantity");
    var users = Object(("9", "Employee"), ("10", "Other"));
    Cmd(
        "mapping",
        Object(("user_id", 9), ("warehouse_id", 3), ("warehouses", Warehouses()), ("users", users))
    );
    Reject(
        () =>
            Cmd(
                "mapping",
                Object(
                    ("user_id", 10),
                    ("warehouse_id", 3),
                    ("warehouses", Warehouses()),
                    ("users", users)
                )
            ),
        "Warehouse ownership is unique"
    );
    var handoff = PlanData(box, "checkout", Object(("person_id", 9), ("reason", "Field work")));
    handoff["users"] = users.DeepClone();
    var pending = Stage(handoff, true);
    Finish(box, pending, true);
    Check(
        GetItem(box).I("warehouse_id") == 3 && GetItem(box)["checkout"]!.I("user_id") == 9,
        "Checkout location and borrower"
    );
    Reject(
        () =>
            Cmd(
                "mapping",
                Object(
                    ("user_id", 9),
                    ("warehouse_id", 2),
                    ("warehouses", Warehouses()),
                    ("users", users)
                )
            ),
        "Loan prevents mapping change"
    );
    var checkin = PlanData(box, "checkin", Object(("person_id", 9)));
    checkin["users"] = users.DeepClone();
    Finish(box, Stage(checkin, true), true);
    Check(
        GetItem(box).I("warehouse_id") == 1
            && GetItem(box).S("bin") == "A-2"
            && GetItem(box)["checkout"] is null,
        "Checkin restores original bin"
    );
    var unknownBox = Cmd("create", Fields("box", null))!.GetValue<string>();
    if (!OperatingSystem.IsWindows())
    {
        var entityDirectory = Path.Combine(directory, "entity-1");
        Check(
            File.GetUnixFileMode(entityDirectory)
                == (UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute),
            "Entity directories are owner-only"
        );
        Check(
            File.GetUnixFileMode(Path.Combine(entityDirectory, "state.json"))
                == (UnixFileMode.UserRead | UnixFileMode.UserWrite),
            "Persisted inventory is owner-only"
        );
    }
    var summary = (JsonObject)
        service.Execute(
            admin with
            {
                Manage = false,
                Admin = false,
            },
            "query-warehouse-summary",
            Object(("warehouse_id", 1))
        )!;
    Check(
        summary["4"]!.I("unknown") == 1 && summary["4"]!.I("known") == 5,
        "Warehouse aggregation separates unknown container count"
    );
    var binSummary = (JsonObject)
        Cmd("query-bin-summary", Object(("warehouse_id", 1), ("bin", "A-2")))!;
    Check(
        binSummary["totals"]![0]!.I("box") == 5
            && binSummary["totals"]![0]!.I("unknown_boxes") == 1,
        "Bin aggregation"
    );
    var bins = (JsonArray)Cmd("query-known-bins", Object(("warehouse_id", 1)))!;
    Check(bins.Count == 1 && bins[0]!.GetValue<string>() == "A-2", "Known bin deduplication");
    var restrictedSummary = (JsonObject)
        Cmd(
            "query-bin-summary",
            Object(("warehouse_id", 1), ("bin", "A-2"), ("visible_codes", Array.Empty<string>()))
        )!;
    Check(
        ((JsonArray)restrictedSummary["tracked"]!).Count == 0
            && ((JsonArray)restrictedSummary["totals"]!).Count == 0,
        "Read models cannot reintroduce items excluded by the native adapter"
    );
    var restrictedBins = (JsonArray)
        Cmd(
            "query-known-bins",
            Object(("warehouse_id", 1), ("visible_codes", Array.Empty<string>()))
        )!;
    Check(restrictedBins.Count == 0, "Known bins respect native object visibility");
    var pick = (JsonArray)
        Cmd(
            "query-pick",
            Object(
                ("warehouse_id", 1),
                (
                    "lines",
                    new[]
                    {
                        new
                        {
                            product_id = 4,
                            qty = 4.0,
                            label = "Parts",
                        },
                        new
                        {
                            product_id = 4,
                            qty = 4.0,
                            label = "Parts",
                        },
                    }
                )
            )
        )!;
    Check(
        pick.Sum(n => n!.S("type") == "missing" ? n!["take"]!.GetValue<double>() : 0) == 3,
        "Picking does not reuse quantity across order lines or allocate unknown boxes"
    );
    var batchSummary = (JsonObject)Cmd("query-batches", new JsonObject())!;
    Check(
        batchSummary.I("remaining_batches") == 2 && batchSummary.I("unassigned_total") == 3,
        "Printable batch aggregation"
    );
    Reject(
        () =>
            service.Execute(
                admin with
                {
                    Stock = false,
                },
                "plan",
                PlanData(box, "consume", Object(("quantity", 1), ("post_stock", true)))
            ),
        "Native stock permission"
    );
    // Independent repository instances must serialize writes to the same entity.
    var before = State().Map("items").Count;
    Parallel.For(
        0,
        20,
        _ =>
            new InventoryService(
                new StateRepository(Options.Create(new AppSettings { DataDirectory = directory }))
            ).Execute(admin, "bulk", Object(("count", 1)))
    );
    Check(State().Map("items").Count == before + 20, "Concurrent writers retain all mutations");
    var path = Path.Combine(directory, "entity-4");
    Directory.CreateDirectory(path);
    File.WriteAllText(Path.Combine(path, "state.json"), "broken");
    try
    {
        service.State(admin with { EntityId = 4 });
        throw new Exception("Corrupt state was accepted");
    }
    catch (System.Text.Json.JsonException)
    {
        passed++;
    }
    Check(
        File.ReadAllText(Path.Combine(path, "state.json")) == "broken",
        "Corrupt state is never overwritten"
    );
    var nativeActor = admin with { EntityId = 20 };
    JsonNode? Native(string action, JsonObject fields) =>
        service.Execute(nativeActor, action, fields);
    var nativeFields = Fields("box", 12);
    nativeFields["label"] = "Box A";
    nativeFields["native_batch"] = "Box A";
    var intent = (JsonObject)
        Native("native-stage", Object(("action", "create"), ("fields", nativeFields)))!;
    var nativeCode = intent.S("result");
    Check(
        service.State(nativeActor).Map("items").Count == 0,
        "Native intent does not publish uncommitted inventory"
    );
    Reject(
        () => Native("create", nativeFields),
        "Pending native intent prevents concurrent mutation"
    );
    Reject(
        () =>
            Native("native-finish", Object(("id", intent.S("id")), ("bindings", new JsonObject()))),
        "Missing lot receipt cannot publish inventory"
    );
    Native("native-finish", Object(("id", intent.S("id")), ("bindings", Object((nativeCode, 51)))));
    Check(
        service.State(nativeActor).Map("items")[nativeCode]!.I("product_lot_id") == 51,
        "Native receipt binds QR identity to a distinct Dolibarr lot ID"
    );
    Reject(
        () => Native("native-stage", Object(("action", "create"), ("fields", nativeFields))),
        "Duplicate native lot identity cannot get a second QR"
    );
    var nativePlan = PlanData(nativeCode, "correct", Object(("quantity", 9)));
    nativePlan["native_items"] = Object((nativeCode, Object(("qty", 7), ("warehouse_id", 1))));
    var observedPlan = (JsonObject)Native("plan", nativePlan)!;
    Check(
        observedPlan["effects"]![0]!.I("delta") == 2,
        "Stock correction plans from native stock observations, not cached quantity"
    );
    var nativeMove = PlanData(
        nativeCode,
        "move",
        Object(("warehouse_id", 1), ("choice", Object(("bin", "B"))))
    );
    var nativeMovePlan = (JsonObject)Native("plan", nativeMove)!;
    nativeMove["revision"] = nativeMovePlan.I("revision");
    var nativeMoveOp = (JsonObject)Native("stage", nativeMove)!;
    Check(
        service.State(nativeActor).Map("items")[nativeCode]!["pending_operation"] is not null,
        "Same-warehouse Binloc changes are durably staged"
    );
    Reject(
        () =>
            Native(
                "finish",
                Object(
                    ("code", nativeCode),
                    ("id", nativeMoveOp.S("id")),
                    ("proof", new { seen = Array.Empty<int>(), other = 0 })
                )
            ),
        "Location changes need native Binloc evidence"
    );
    Native(
        "finish",
        Object(
            ("code", nativeCode),
            ("id", nativeMoveOp.S("id")),
            (
                "proof",
                new
                {
                    seen = Array.Empty<int>(),
                    other = 0,
                    location = true,
                }
            )
        )
    );
    Check(
        service.State(nativeActor).Map("items")[nativeCode]!.S("bin") == "B",
        "Verified Binloc change finalizes"
    );
    Reject(
        () =>
            Native(
                "plan",
                PlanData(nativeCode, "consume", Object(("quantity", 1), ("post_stock", false)))
            ),
        "Native-linked consumption cannot silently change cached counts only"
    );
    Console.WriteLine($"Passed {passed} assertions.");
}
finally
{
    Directory.Delete(directory, true);
}
