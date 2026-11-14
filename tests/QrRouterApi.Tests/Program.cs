using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
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
    Interlocked.Increment(ref passed);
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
            File.GetUnixFileMode(Path.Combine(entityDirectory, "state.sqlite3"))
                == (UnixFileMode.UserRead | UnixFileMode.UserWrite),
            "Persisted inventory is owner-only"
        );
    }
    var summary = (JsonObject)
        service.Execute(
            admin with
            {
                Use = true,
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
    var locationState = Object(("items", Object()));
    foreach (
        var (code, bin, wid, status, locationPending) in new[]
        {
            ("AAAAAA", "A-1", 1, "available", false),
            ("BBBBBB", "B-2", 1, "available", false),
            ("CCCCCC", "", 1, "available", false),
            ("DDDDDD", "A-1", 2, "available", false),
            ("EEEEEE", "A-1", 1, "consumed", false),
            ("FFFFFF", "A-1", 1, "available", true),
        }
    )
        locationState.Map("items")[code] = Object(
            ("code", code),
            ("type", "tracked"),
            ("product_id", 4),
            ("warehouse_id", wid),
            ("bin", bin),
            ("status", status),
            ("pending_operation", locationPending ? Object(("id", "pending")) : null)
        );
    JsonArray LocationRows(JsonObject filter) =>
        (JsonArray)InventoryQueries.Execute(locationState, "query-bin-summary", filter)["tracked"]!;
    Check(
        LocationRows(Object(("warehouse_id", 1), ("bin", ""))).Count == 3,
        "No bin filter includes all warehouse locations and unlocated items, excluding unavailable records"
    );
    Check(
        LocationRows(Object(("warehouse_id", 1), ("bin", "A-1"))).Single()!.S("code") == "AAAAAA",
        "Selected bin narrows the warehouse inventory"
    );
    Check(
        LocationRows(Object(("warehouse_id", 1), ("visible_codes", new[] { "CCCCCC" })))
            .Single()!
            .S("code") == "CCCCCC",
        "Whole-warehouse inventory respects native visibility"
    );
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
    // Migrate real schema-2 state without losing history, unknown metadata or recovery data.
    var migrationDirectory = Path.Combine(directory, "entity-50");
    Directory.CreateDirectory(migrationDirectory);
    var original = State();
    original["pending_native"] = Object(
        ("id", "migration-recovery"),
        ("changes", new JsonObject())
    );
    original["custom_metadata"] = "Preserve future fields";
    var legacyPath = Path.Combine(migrationDirectory, "state.json");
    var legacyJson = original.ToJsonString();
    File.WriteAllText(legacyPath, legacyJson);
    Parallel.For(
        0,
        8,
        _ =>
            Check(
                JsonNode.DeepEquals(original, repository.Read(50, s => s)),
                "Concurrent first access imports a complete, consistent snapshot"
            )
    );
    Check(File.ReadAllText(legacyPath) == legacyJson, "Migration preserves original JSON backup");
    var migrated = repository.Read(50, s => s);
    using (
        var db = new InventoryDbContext(
            InventoryDbContext.OptionsFor(Path.Combine(migrationDirectory, "state.sqlite3"))
        )
    )
    {
        Check(
            !Microsoft.EntityFrameworkCore.RelationalDatabaseFacadeExtensions.HasPendingModelChanges(
                db.Database
            ),
            "EF model matches its committed migration snapshot"
        );
        Check(
            Microsoft
                .EntityFrameworkCore.RelationalDatabaseFacadeExtensions.GetAppliedMigrations(
                    db.Database
                )
                .Count() == 2,
            "Both EF migrations are applied exactly once"
        );
    }
    Reject(
        () =>
            repository.Update<int>(
                50,
                7,
                "fail",
                new JsonObject(),
                s =>
                {
                    s.Map("items").Clear();
                    throw new ArgumentException("Cancel transaction");
                }
            ),
        "Failed command rolls back all changes"
    );
    Check(
        JsonNode.DeepEquals(migrated, repository.Read(50, s => s)),
        "Rejected transaction leaves inventory, revision and history intact"
    );
    repository.Update(
        50,
        7,
        "test",
        new JsonObject(),
        s =>
        {
            s.Remove("pending_native");
            s.Map("items").Remove(s.Map("items").First().Key);
            return 0;
        }
    );
    var changedState = repository.Read(50, s => s);
    Check(
        changedState["pending_native"] is null
            && changedState.Map("items").Count == original.Map("items").Count - 1
            && ((JsonArray)changedState["history"]!).Count
                == ((JsonArray)original["history"]!).Count + 1,
        "Record deletion, metadata removal and audit append commit together"
    );
    Check(
        File.ReadAllText(legacyPath) == legacyJson,
        "SQLite updates never overwrite migration backup"
    );
    Check(
        repository.Read(50, s => ((JsonArray)s["history"]!).Count, includeHistory: false) == 0,
        "Operational reads omit accumulated audit history"
    );
    var observed = changedState.Map("items").First().Key;
    var selected = repository.Read(
        50,
        s => s.Map("items"),
        includeHistory: false,
        selection: new StateSelection(-1, [observed])
    );
    Check(
        selected.Count == 1 && selected.ContainsKey(observed),
        "Warehouse selection retains observed native items from other warehouses"
    );
    using (
        var db = new SqliteConnection(
            $"Data Source={Path.Combine(migrationDirectory, "state.sqlite3")};Pooling=False"
        )
    )
    {
        db.Open();
        using var query = db.CreateCommand();
        query.CommandText =
            "EXPLAIN QUERY PLAN SELECT document FROM records WHERE collection='items' AND warehouse_id=1";
        using var rows = query.ExecuteReader();
        Check(
            rows.Read() && rows.GetString(3).Contains("records_warehouse"),
            "Warehouse retrieval uses the database index"
        );
    }
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
    File.WriteAllText(Path.Combine(path, "state.json"), legacyJson);
    Check(
        JsonNode.DeepEquals(original, repository.Read(4, s => s)),
        "Failed legacy import can retry without partially initialized state"
    );
    var movedIn = Codes.New();
    var movedOut = Codes.New();
    var outside = Codes.New();
    repository.Update(
        51,
        7,
        "seed",
        new JsonObject(),
        s =>
        {
            foreach (var (code, warehouse) in new[] { (movedIn, 2), (movedOut, 1), (outside, 3) })
                s.Map("items")[code] = Object(
                    ("code", code),
                    ("type", "generic"),
                    ("status", "in_stock"),
                    ("product_id", 4),
                    ("product_lot_id", 1),
                    ("warehouse_id", warehouse)
                );
            return 0;
        }
    );
    var liveSummary = service.Execute(
        admin with
        {
            EntityId = 51,
        },
        "query-warehouse-summary",
        Object(
            ("warehouse_id", 1),
            (
                "native_items",
                Object(
                    (movedIn, Object(("warehouse_id", 1))),
                    (movedOut, Object(("warehouse_id", 2))),
                    (outside, Object(("warehouse_id", 3)))
                )
            )
        )
    )!;
    Check(
        liveSummary["4"]!.I("known") == 1,
        "Indexed queries include native arrivals, exclude native departures and skip unrelated observations"
    );
    Check(
        repository.Read(51, s => s.Map("items")[movedIn]!.I("warehouse_id")) == 2,
        "Read-model observations do not mutate persistent stock snapshots"
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
        "Same-warehouse internal location changes are durably staged"
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
        "Internal location change finalizes without Binloc evidence"
    );
    Reject(
        () =>
            Native(
                "plan",
                PlanData(nativeCode, "consume", Object(("quantity", 1), ("post_stock", false)))
            ),
        "Native-linked consumption cannot silently change cached counts only"
    );
    passed += LocationTests.Run(directory);
    passed += PermissionTests.Run(directory);
    var deletionActor = admin with { EntityId = 90 };
    JsonNode? DeleteRun(string action, JsonObject data) =>
        service.Execute(deletionActor, action, data);
    var deletionBatch = DeleteRun("bulk", Object(("type", "unassigned"), ("count", 2)))!
        .GetValue<string>();
    var deletionCodes = (JsonArray)
        service.State(deletionActor)["batches"]![deletionBatch]!["codes"]!;
    var unusedCode = deletionCodes[0]!.GetValue<string>();
    var remainingCode = deletionCodes[1]!.GetValue<string>();
    Reject(
        () =>
            service.Execute(
                deletionActor with
                {
                    Manage = false,
                    Admin = false,
                },
                "delete-unassigned",
                Object(("code", unusedCode))
            ),
        "Readers cannot delete labels"
    );
    DeleteRun("delete-unassigned", Object(("code", unusedCode)));
    var afterDelete = service.State(deletionActor);
    Check(
        !afterDelete.Map("items").ContainsKey(unusedCode)
            && afterDelete.Map("items").ContainsKey(remainingCode),
        "Deletion removes only the selected unassigned label"
    );
    Check(
        afterDelete["batches"]![deletionBatch]!["codes"]!.AsArray().Count == 1,
        "Deleted label removed from print batch"
    );
    Check(
        afterDelete["history"]!.AsArray().Last().S("action") == "delete-unassigned",
        "Deletion retained in audit history"
    );
    DeleteRun("delete-unassigned", Object(("code", remainingCode)));
    Check(
        !service.State(deletionActor).Map("batches").ContainsKey(deletionBatch),
        "Empty print batch removed"
    );
    var assignedCode = DeleteRun("create", Object(("type", "generic"), ("product_id", 1)))!
        .GetValue<string>();
    var beforeDeleteRejection = service.State(deletionActor).ToJsonString();
    Reject(
        () => DeleteRun("delete-unassigned", Object(("code", assignedCode))),
        "Assigned labels cannot be deleted"
    );
    Check(
        service.State(deletionActor).ToJsonString() == beforeDeleteRejection,
        "Rejected deletion preserves state and history"
    );
    Check(
        !new StateRepository(Options.Create(new AppSettings { DataDirectory = directory })).Read(
            90,
            s => s.Map("items").ContainsKey(unusedCode)
        ),
        "Deletion persists across restarts"
    );
    var pickFields = Fields("box", 5);
    pickFields["product_id"] = 44;
    var pickCode = Cmd("create", pickFields)!.GetValue<string>();
    var guardedPick = Object(
        ("order_id", 390),
        ("warehouse_id", 1),
        ("lines", new[] { new { product_id = 44, qty = 2.0 } })
    );
    var guardedRows = (JsonArray)Cmd("query-pick", guardedPick)!;
    Check(guardedRows.Any(row => row.S("code") == pickCode), "Pick list contains eligible box");
    JsonObject PickArgs(int quantity) =>
        Object(
            ("quantity", quantity),
            ("post_stock", true),
            ("reference_type", "salesorder"),
            ("reference_id", 390),
            ("pick_list", guardedPick.DeepClone())
        );
    Reject(() => Stage(PlanData(pickCode, "consume", PickArgs(3))), "Overpick rejected at staging");
    var guardedOperation = Stage(PlanData(pickCode, "consume", PickArgs(2)));
    Check(
        ((JsonArray)Cmd("query-pick", guardedPick)!).Count == 0,
        "Pending picks count against order allowance"
    );
    Finish(pickCode, guardedOperation);
    Check(
        ((JsonArray)Cmd("query-pick", guardedPick)!).Count == 0,
        "Completed picks cannot be picked again"
    );
    Reject(() => Stage(PlanData(pickCode, "consume", PickArgs(1))), "Repeated pick rejected");
    var savedList = Object(
        ("order_id", 391),
        ("warehouse_id", 1),
        ("lines", new[] { new { product_id = 44, qty = 5.0 } })
    );
    Cmd("pick-list-save", savedList);
    Reject(
        () => Cmd("pick-list-complete", Object(("order_id", 391), ("reason", ""))),
        "Manual completion requires a reason"
    );
    var manualPickArgs = PickArgs(1);
    manualPickArgs["reference_id"] = 391;
    manualPickArgs["pick_list"] = savedList.DeepClone();
    var partialPick = Stage(PlanData(pickCode, "consume", manualPickArgs));
    Reject(
        () => Cmd("pick-list-complete", Object(("order_id", 391), ("reason", "Untracked stock"))),
        "Manual completion cannot hide a pending operation"
    );
    Finish(pickCode, partialPick);
    var changedListRequest = (JsonObject)savedList.DeepClone();
    changedListRequest["lines"] = Object(("ignored", true));
    Check(
        ((JsonArray)Cmd("query-pick", changedListRequest)!).Sum(row =>
            row!["take"]!.GetValue<double>()
        ) == 4,
        "Saved pick list keeps its trusted requested quantities"
    );
    var progress = ((JsonArray)Cmd("query-pick-lists", new JsonObject())!).Single(list =>
        list!.I("order_id") == 391
    )!;
    Check(
        progress.S("status") == "in_progress" && progress["lines"]![0]!.I("picked") == 1,
        "Partially fulfilled lists retain progress"
    );
    var beforeManual = GetItem(pickCode).ToJsonString();
    Cmd(
        "pick-list-complete",
        Object(("order_id", 391), ("reason", "Remaining four supplied from untracked stock"))
    );
    Check(
        GetItem(pickCode).ToJsonString() == beforeManual,
        "Manual completion leaves inventory unchanged"
    );
    var reopenedPicks = new InventoryService(
        new StateRepository(Options.Create(new AppSettings { DataDirectory = directory }))
    );
    var durableLists = (JsonArray)
        reopenedPicks.Execute(admin, "query-pick-lists", new JsonObject())!;
    Check(
        durableLists.Single(list => list!.I("order_id") == 391)!.S("status")
            == "manually_completed",
        "Saved list and manual completion survive service restart"
    );
    Check(
        ((JsonArray)Cmd("query-pick", savedList)!).Count == 0,
        "Manually completed lists cannot be overpicked"
    );
    JsonObject InternalChoice(string name, int warehouse = 1) =>
        (JsonObject)
            Cmd(
                "query-location-choice",
                Object(
                    ("warehouse_id", warehouse),
                    ("levels", Object(("1", name))),
                    (
                        "warehouses",
                        Object(("1", Object(("ref", "MAIN"))), ("2", Object(("ref", "OTHER"))))
                    )
                )
            )!;
    const string sourceLocation = "AISLE-A.01";
    const string targetLocation = "RACK-B.02";
    var physicalBin = Cmd(
        "physical-bin-create",
        Object(
            ("label", "Blue tote"),
            ("warehouse_id", 1),
            ("choice", InternalChoice(sourceLocation))
        )
    )!;
    var binId = physicalBin.S("id");
    var packedCodes = new List<string>();
    foreach (var units in new[] { 3, 5 })
    {
        var fields = Fields("box", units);
        fields["choice"] = InternalChoice(sourceLocation);
        packedCodes.Add(Cmd("create", fields)!.GetValue<string>());
    }
    Cmd("physical-bin-assign", Object(("bin_id", binId), ("codes", packedCodes)));
    Check(
        packedCodes.All(code => GetItem(code).S("physical_bin_id") == binId),
        "Items are packed without a stock mutation"
    );
    Reject(
        () => Cmd("physical-bin-assign", Object(("bin_id", binId), ("codes", new[] { pickCode }))),
        "Packing items from another location rejected"
    );
    var binMove = Cmd(
        "physical-bin-move-start",
        Object(
            ("bin_id", binId),
            ("warehouse_id", 2),
            ("choice", InternalChoice(targetLocation, 2))
        )
    )!;
    Reject(
        () => Stage(PlanData(packedCodes[0], "consume", Object(("quantity", 1)))),
        "Packed items are locked during bin moves"
    );
    Reject(
        () =>
            Cmd(
                "physical-bin-assign",
                Object(("bin_id", binId), ("codes", packedCodes), ("remove", true))
            ),
        "Unpacking during a move rejected"
    );
    JsonObject BinMoveArgs() =>
        Object(
            ("warehouse_id", 2),
            ("choice", InternalChoice(targetLocation, 2)),
            ("physical_bin_move", binId)
        );
    var firstPackedMove = Stage(PlanData(packedCodes[0], "move", BinMoveArgs()));
    Finish(packedCodes[0], firstPackedMove);
    Reject(
        () => Cmd("physical-bin-move-finish", Object(("bin_id", binId))),
        "Partially moved bin remains pending"
    );
    var resumedService = new InventoryService(
        new StateRepository(Options.Create(new AppSettings { DataDirectory = directory }))
    );
    var pendingBins = (JsonArray)
        resumedService.Execute(admin, "query-physical-bins", new JsonObject())!;
    Check(
        pendingBins.Single(bin => bin.S("id") == binId)!["pending_move"] is not null,
        "Physical bin move survives restart"
    );
    var secondPackedMove = Stage(PlanData(packedCodes[1], "move", BinMoveArgs()));
    Reject(
        () => Cmd("physical-bin-move-finish", Object(("bin_id", binId))),
        "Pending native movements must finish before a bin move closes"
    );
    Finish(packedCodes[1], secondPackedMove);
    Cmd("physical-bin-move-finish", Object(("bin_id", binId)));
    Check(
        packedCodes.All(code =>
            GetItem(code).I("warehouse_id") == 2
            && GetItem(code).S("physical_bin_id") == binId
            && GetItem(code)["pending_bin_move"] is null
        ),
        "Whole bin moves retain membership and clear locks"
    );
    Check(
        packedCodes.Sum(code => GetItem(code).I("qty")) == 8,
        "Physical bin moves conserve quantities"
    );
    var standaloneMove = Stage(
        PlanData(
            packedCodes[0],
            "move",
            Object(("warehouse_id", 1), ("choice", InternalChoice(sourceLocation)))
        )
    );
    Finish(packedCodes[0], standaloneMove);
    Check(
        GetItem(packedCodes[0]).S("physical_bin_id") == "",
        "Moving an individual item unpacks it"
    );
    Reject(
        () =>
            Cmd(
                "location-configure",
                Object(
                    ("warehouse_id", 2),
                    ("warehouses", Object(("2", Object(("ref", "OTHER"))))),
                    ("names", new[] { "Location" }),
                    ("datatypes", new[] { "number" })
                )
            ),
        "Physical bin assignments preserve upstream location level datatypes"
    );
    var revisionBeforeHistory = State().I("revision");
    var history = (JsonObject)Cmd("query-history", Object(("page", 1), ("page_size", 2)))!;
    Check(
        ((JsonArray)history["entries"]!).Count == 2 && history.I("total") > 2,
        "Audit history is paginated"
    );
    var firstHistory = history["entries"]![0]!;
    var secondHistory = history["entries"]![1]!;
    Check(
        firstHistory["id"]!.GetValue<long>() > secondHistory["id"]!.GetValue<long>(),
        "Newest actions appear first"
    );
    Check(
        State().I("revision") == revisionBeforeHistory,
        "Viewing history does not create audit events"
    );
    var historyPageTwo = (JsonObject)Cmd("query-history", Object(("page", 2), ("page_size", 2)))!;
    Check(
        historyPageTwo["entries"]![0]!["id"]!.GetValue<long>()
            < secondHistory["id"]!.GetValue<long>(),
        "Audit pages do not overlap"
    );
    var packedHistory = (JsonObject)Cmd("query-history", Object(("q", binId)))!;
    Check(packedHistory.I("total") >= 3, "Physical bin actions are searchable");
    var actorHistory = (JsonObject)
        Cmd("query-history", Object(("user_id", admin.UserId), ("action", "physical-bin-assign")))!;
    Check(
        ((JsonArray)actorHistory["entries"]!).All(row =>
            row.I("user_id") == admin.UserId && row.S("action") == "physical-bin-assign"
        ),
        "Actor and event filters apply together"
    );
    var noHistory = (JsonObject)Cmd("query-history", Object(("from", "2099-01-01T00:00:00Z")))!;
    Check(noHistory.I("total") == 0, "Audit dates filter events");
    Reject(
        () => service.Execute(admin with { Admin = false }, "query-history", new JsonObject()),
        "Audit access without the history permission is rejected"
    );
    var historyReader = admin with
    {
        Admin = false,
        Manage = false,
        Stock = false,
        History = true,
        Use = true,
    };
    var visibility = Object(
        ("codes", State().Map("items").Select(pair => pair.Key).ToArray()),
        ("warehouses", new[] { 1, 2, 3 }),
        ("bins", new[] { binId }),
        ("references", new[] { "salesorder:391" })
    );
    var qrHistory = (JsonObject)
        service.Execute(
            historyReader,
            "query-history",
            Object(("code", packedCodes[0]), ("visibility", visibility))
        )!;
    Check(qrHistory.I("total") > 0, "History permission grants read-only users access");
    var hiddenReferenceScope = (JsonObject)visibility.DeepClone();
    hiddenReferenceScope["references"] = new JsonArray();
    Check(
        (
            (JsonObject)
                service.Execute(
                    historyReader,
                    "query-history",
                    Object(("action", "pick-list-complete"), ("visibility", hiddenReferenceScope))
                )!
        ).I("total") == 0,
        "History does not reveal orders outside the native document scope"
    );
    var hiddenItemScope = (JsonObject)visibility.DeepClone();
    hiddenItemScope["codes"] = new JsonArray();
    Check(
        (
            (JsonObject)
                service.Execute(
                    historyReader,
                    "query-history",
                    Object(("code", packedCodes[0]), ("visibility", hiddenItemScope))
                )!
        ).I("total") == 0,
        "Exact QR searches cannot bypass native item visibility"
    );
    Check(
        qrHistory["entries"]!
            .AsArray()
            .All(row =>
                row!["codes"]!.AsArray().Any(code => code!.GetValue<string>() == packedCodes[0])
            ),
        "QR history contains only actions affecting the exact QR identifier"
    );
    Reject(
        () =>
            service.Execute(
                historyReader with
                {
                    History = false,
                },
                "query-history",
                Object(("code", packedCodes[0]), ("visibility", visibility))
            ),
        "Per-QR history uses the same permission as the separate page"
    );
    Reject(
        () => Cmd("query-history", Object(("code", "invalid"))),
        "Invalid exact QR filters are rejected"
    );
    Reject(
        () => Cmd("query-history", Object(("page_size", 101))),
        "Unbounded audit requests rejected"
    );
    Reject(() => Cmd("query-history", Object(("from", "invalid"))), "Invalid audit dates rejected");
    Check(
        (
            (JsonObject)
                service.Execute(admin with { EntityId = 999 }, "query-history", new JsonObject())!
        ).I("total") == 0,
        "History is entity scoped"
    );
    var privateHistory = (JsonObject)Cmd("query-history", Object(("action", "native-stage")))!;
    Check(
        !privateHistory.ToJsonString().Contains("\"changes\"")
            && !privateHistory.ToJsonString().Contains("\"context\""),
        "History omits internal state snapshots"
    );
    var completedMoves = (JsonObject)
        Cmd("query-history", Object(("action", "finish"), ("q", packedCodes[0])))!;
    var lastMove = completedMoves["entries"]![0]!;
    Check(
        lastMove.I("source_warehouse_id") == 2
            && lastMove.I("warehouse_id") == 1
            && lastMove.I("quantity") == 3,
        "Completed move audit retains source, destination and moved quantity"
    );
    var historyAfterRestart = (JsonObject)
        reopenedPicks.Execute(
            admin,
            "query-history",
            Object(("action", "finish"), ("q", packedCodes[0]))
        )!;
    Check(
        historyAfterRestart.I("total") == completedMoves.I("total"),
        "Audit history survives reopening storage"
    );
    var legacyHistory = ActionHistory.Project(
        Object(
            ("action", "native-stage"),
            ("at", "2025-01-01T00:00:00Z"),
            ("user_id", 7),
            ("revision", 1),
            (
                "context",
                Object(
                    (
                        "result",
                        Object(
                            ("action", "create"),
                            ("changes", Object((packedCodes[0], new JsonObject()))),
                            ("items", Object((packedCodes[1], new JsonObject())))
                        )
                    )
                )
            )
        )
    );
    Check(
        legacyHistory["codes"]!.AsArray().Count == 1
            && legacyHistory["codes"]![0]!.GetValue<string>() == packedCodes[0],
        "Legacy history extracts affected records without exposing unrelated native snapshots"
    );
    Console.WriteLine($"Passed {passed} assertions.");
}
finally
{
    Directory.Delete(directory, true);
}
