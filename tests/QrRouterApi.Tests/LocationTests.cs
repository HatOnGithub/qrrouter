using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Options;
using QrRouterApi.DTO;
using QrRouterApi.Helpers;
using QrRouterApi.Repositories;
using QrRouterApi.Services;
using static QrRouterApi.Helpers.Json;

internal static class LocationTests
{
    public static int Run(string directory)
    {
        var count = 0;
        void Check(bool value, string message)
        {
            if (!value)
                throw new Exception(message);
            count++;
        }
        void Reject(Action action)
        {
            try
            {
                action();
            }
            catch (Exception error)
                when (error
                        is ArgumentException
                            or InvalidOperationException
                            or UnauthorizedAccessException
                )
            {
                count++;
                return;
            }
            throw new Exception("Expected location validation rejection");
        }
        var repo = new StateRepository(
            Options.Create(new AppSettings { DataDirectory = directory })
        );
        var service = new InventoryService(repo);
        var actor = new Actor(80, 7, true, true, true, true);
        var warehouses = Object(("1", new { @ref = "MAIN" }), ("2", new { @ref = "OTHER" }));
        JsonObject Data(params (string, object?)[] fields)
        {
            var result = Object(fields);
            result["warehouse_id"] = 1;
            result["warehouses"] = warehouses.DeepClone();
            return result;
        }
        JsonNode? Run(string command, JsonObject data) => service.Execute(actor, command, data);
        Check(
            ((JsonArray)Run("query-location-levels", Data())!).Count == 1,
            "New warehouses work without Binloc"
        );
        Run("location-configure", Data(("names", new[] { "Rack", "Shelf" })));
        // Ordered level values, text safety and entity isolation are enforced by the service.
        var choice = (JsonObject)
            Run("query-location-choice", Data(("levels", Object(("1", "A"), ("2", "3")))))!;
        Check(
            choice.S("bin") == "A-3" && choice.S("bin_key") == "1:va|2:v3",
            "Internal location identity and display"
        );
        Reject(() => Run("query-location-choice", Data(("levels", Object(("2", "3"))))));
        Reject(() => Run("query-location-choice", Data(("levels", Object(("1", "<unsafe>"))))));
        Reject(() =>
            service.Execute(
                actor with
                {
                    Admin = false,
                    Manage = false,
                },
                "location-configure",
                Data(("names", new[] { "Changed" }))
            )
        );
        Check(
            (
                (JsonArray)
                    service.Execute(actor with { EntityId = 81 }, "query-location-levels", Data())!
            ).Count == 1,
            "Location settings stay entity-scoped"
        );
        var code = Run(
                "create",
                Data(("type", "generic"), ("product_id", 4), ("label", "Parts"), ("choice", choice))
            )!
            .GetValue<string>();
        Reject(() => Run("location-configure", Data(("names", new[] { "Rack" }))));
        Run("location-configure", Data(("names", new[] { "Rack", "Shelf", "Position" })));
        Check(
            service.State(actor).Map("items")[code].S("bin") == "A-3",
            "Appending location levels preserves existing assignments"
        );
        Run(
            "label-settings",
            Data(("prefs", Object(("enabled", true), ("show", Object(("2", 1))))))
        );
        Check(
            Run("query-location-label", Data(("code", code)))!.GetValue<string>() == "3",
            "Location print preferences select internal levels"
        );
        Run(
            "label-settings",
            Data(
                (
                    "prefs",
                    Object(("enabled", true), ("show_warehouse", true), ("show", Object(("3", 1))))
                )
            )
        );
        Check(
            Run("query-location-label", Data(("code", code)))!.GetValue<string>() == "A-3",
            "Missing visible values preserve the saved location code"
        );
        Reject(() => Run("label-settings", Data(("prefs", Object(("show", Object(("999", 1))))))));
        Reject(() =>
            Run(
                "label-settings",
                Data(
                    (
                        "prefs",
                        Object(("show", Object(("1", 1))), ("separator", Object(("1", "<unsafe>"))))
                    )
                )
            )
        );
        Reject(() =>
            Run(
                "label-settings",
                Data(
                    (
                        "prefs",
                        Object(
                            ("show", Object(("1", 1))),
                            ("separator", Object(("1", (object?)null)))
                        )
                    )
                )
            )
        );

        var prepared = Creation.Prepare(
            Object(
                ("type", "tracked"),
                ("bulk", true),
                ("count", 200),
                ("labels", Enumerable.Repeat("Same label", 200)),
                ("serial", "MANUAL"),
                ("label_as_serial", true)
            )
        );
        var serials = ((JsonArray)prepared["entries"]!)
            .Select(entry => entry.S("serial"))
            .ToArray();
        Check(
            serials.Distinct().Count() == 200
                && serials.All(value => Regex.IsMatch(value, "^SN-[A-F0-9]{24}$")),
            "Every new individual receives a random, separate serial"
        );
        var existing = Creation.Prepare(
            Object(
                ("type", "tracked"),
                ("existing_serial", "EXISTING-NATIVE"),
                ("serial_prefix", "invalid prefix")
            )
        );
        Check(
            existing["entries"]![0].S("serial") == "EXISTING-NATIVE",
            "Verified native serial links are preserved"
        );
        var prefixed = Creation.Prepare(
            Object(("type", "tracked"), ("bulk", true), ("count", 3), ("serial_prefix", " BOLT- "))
        );
        Check(
            prefixed["entries"]!
                .AsArray()
                .All(entry => Regex.IsMatch(entry.S("serial"), "^BOLT-[A-F0-9]{24}$")),
            "Product prefix applies to every random serial in a batch"
        );
        Check(
            Creation.Prepare(Object(("type", "tracked"), ("serial_prefix", new string('P', 76))))[
                "entries"
            ]!
                [0]
                .S("serial")
                .Length == 100,
            "Prefix and random suffix respect the native serial limit"
        );
        foreach (
            var invalid in new[]
            {
                new string('P', 77),
                "two words",
                "<prefix>",
                "bad\nvalue",
                new string('\u00e9', 39),
            }
        )
            Reject(() => Creation.Prepare(Object(("type", "tracked"), ("serial_prefix", invalid))));
        Reject(() =>
            Creation.Prepare(
                Object(
                    ("type", "tracked"),
                    ("bulk", true),
                    ("count", 2),
                    ("labels", new object[] { "A", new { nested = true } })
                )
            )
        );

        var importedCode = Codes.New();
        repo.Update(
            81,
            7,
            "seed",
            new JsonObject(),
            state =>
            {
                state.Map("items")[importedCode] = Object(
                    ("code", importedCode),
                    ("type", "tracked"),
                    ("product_id", 4),
                    ("warehouse_id", 1),
                    ("serial", "NATIVE-UNCHANGED"),
                    ("bin", "Old code")
                );
                return 0;
            }
        );
        var importedLevels = new JsonArray(
            Object(
                ("id", 4),
                ("label", "Aisle"),
                ("datatype", "list"),
                ("options", new[] { new { id = 12, value = "North" } })
            )
        );
        var import = Object(
            ("warehouses", warehouses),
            ("configurations", Object(("1", Object(("levels", importedLevels))))),
            (
                "assignments",
                Object((importedCode, Object(("warehouse_id", 1), ("levels", Object(("4", 12))))))
            )
        );
        service.Execute(actor with { EntityId = 81 }, "location-import", import);
        Check(
            repo.Read(81, state => state.Map("items")[importedCode].S("bin")) == "North",
            "One-time import resolves native option values into internal location codes"
        );
        Check(
            repo.Read(81, state => state.Map("items")[importedCode].S("serial"))
                == "NATIVE-UNCHANGED",
            "Location import does not change serial identities"
        );
        Reject(() => service.Execute(actor with { EntityId = 81 }, "location-import", import));
        service.Execute(
            actor with
            {
                EntityId = 81,
            },
            "location-configure",
            Data(("names", new[] { "Aisle" }), ("options", Object(("4", new[] { "South" }))))
        );
        var expanded = (JsonArray)
            service.Execute(actor with { EntityId = 81 }, "query-location-levels", Data())!;
        Check(
            ((JsonArray)expanded[0]!["options"]!).Count == 2
                && expanded[0]!["options"]![0]!.I("id") == 12,
            "Imported options can grow internally without changing existing identities"
        );
        Reject(() =>
            service.Execute(actor with { EntityId = 81, Admin = false }, "location-import", import)
        );

        // Reports use saved level values, even if displayed bin labels share a prefix.
        var reportState = service.State(actor);
        foreach (
            var (rack, shelf, type, qty) in new[]
            {
                ("A", "4", "tracked", (int?)1),
                ("A10", "3", "generic", (int?)1),
                ("A", "8", "box", (int?)null),
            }
        )
        {
            var reportCode = Codes.New();
            reportState.Map("items")[reportCode] = Object(
                ("code", reportCode),
                ("product_id", 4),
                ("type", type),
                ("qty", qty),
                ("warehouse_id", 1),
                ("bin", rack + "-" + shelf),
                ("bin_values", Object(("1", rack), ("2", shelf)))
            );
        }
        var report = InventoryQueries.Execute(
            reportState,
            "query-bin-summary",
            Data(("level_id", 1), ("level_value", "a"))
        );
        Check(
            report.S("scope") == "Rack: a"
                && report["tracked"]!.AsArray().Count == 1
                && report["totals"]![0].I("generic") == 1
                && report["totals"]![0].I("unknown_boxes") == 1,
            "Level reports include all child locations without matching similarly named racks"
        );
        var shelfReport = InventoryQueries.Execute(
            reportState,
            "query-bin-summary",
            Data(("level_id", 2), ("level_value", "3"))
        );
        Check(
            shelfReport["totals"]![0].I("generic") == 2,
            "Shelf reports span racks with the same shelf value"
        );
        var privateReport = InventoryQueries.Execute(
            reportState,
            "query-bin-summary",
            Data(("level_id", 1), ("level_value", "A"), ("visible_codes", new[] { code }))
        );
        Check(
            privateReport["tracked"]!.AsArray().Count == 0
                && privateReport["totals"]![0].I("unknown_boxes") == 0,
            "Level reports preserve native record visibility"
        );
        Reject(() =>
            InventoryQueries.Execute(
                reportState,
                "query-bin-summary",
                Data(("level_id", 999), ("level_value", "A"))
            )
        );
        var listReport = service.Execute(
            actor with
            {
                EntityId = 81,
                Admin = false,
                Manage = false,
            },
            "query-bin-summary",
            Data(("level_id", 4), ("level_value", "12"))
        )!;
        Check(
            listReport.S("scope") == "Aisle: North"
                && listReport["tracked"]![0].S("code") == importedCode,
            "Read-only level reports resolve native option identities to labels"
        );

        // Each level owns its input type, option identities and assignment validation.
        var typedActor = actor with
        {
            EntityId = 83,
        };
        JsonNode? Typed(string command, JsonObject data) =>
            service.Execute(typedActor, command, data);
        var typedNames = new[] { "Aisle", "Shelf", "Position", "Section" };
        var typedTypes = new[] { "letter", "number", "text", "list" };
        var typedLevels = (JsonArray)
            Typed(
                "location-configure",
                Data(
                    ("names", typedNames),
                    ("datatypes", typedTypes),
                    (
                        "option_additions",
                        new[]
                        {
                            new[] { "AA" },
                            Array.Empty<string>(),
                            Array.Empty<string>(),
                            new[] { "Left", "Right" },
                        }
                    )
                )
            )!;
        Check(
            typedLevels[0]!["options"]!.AsArray().Count == 27
                && typedLevels[0]!["options"]![26].S("value") == "AA",
            "Letter levels start with A-Z and support additional letter values"
        );
        Check(
            typedLevels[3]!["options"]![1].S("value") == "Right",
            "New list levels accept named options"
        );
        var typedValues = Object(("1", 27), ("2", "12.5"), ("3", "Custom text"), ("4", 2));
        var typedChoice = Typed("query-location-choice", Data(("levels", typedValues)))!;
        Check(
            typedChoice.S("bin") == "AA-12.5-Custom text-Right",
            "Mixed level types resolve to a readable location"
        );
        var invalidValues = (JsonObject)typedValues.DeepClone();
        invalidValues["2"] = "Not a number";
        Reject(() => Typed("query-location-choice", Data(("levels", invalidValues))));
        invalidValues["2"] = "1";
        invalidValues["1"] = 999;
        Reject(() => Typed("query-location-choice", Data(("levels", invalidValues))));
        Reject(() =>
            Typed(
                "location-configure",
                Data(("names", typedNames), ("datatypes", new[] { "date" }))
            )
        );
        var usedCode = Typed(
                "create",
                Data(("type", "generic"), ("product_id", 4), ("choice", typedChoice))
            )!
            .GetValue<string>();
        var beforeTypes = service.State(typedActor).ToJsonString();
        Reject(() =>
            Typed(
                "location-configure",
                Data(
                    ("names", typedNames),
                    ("datatypes", new[] { "text", "number", "text", "list" })
                )
            )
        );
        Check(
            service.State(typedActor).ToJsonString() == beforeTypes,
            "Rejected datatype changes preserve all saved assignments"
        );
        var expandedNames = typedNames.Append("Unused").ToArray();
        Typed(
            "location-configure",
            Data(("names", expandedNames), ("datatypes", typedTypes.Append("text").ToArray()))
        );
        Typed(
            "location-configure",
            Data(("names", expandedNames), ("datatypes", typedTypes.Append("number").ToArray()))
        );
        Check(
            ((JsonArray)Typed("query-location-levels", Data())!)[4].S("datatype") == "number",
            "Unused levels can change type in a warehouse with other assignments"
        );
        Typed(
            "location-configure",
            Data(("names", expandedNames), ("options", Object(("1", new[] { "AB" }))))
        );
        var letters = ((JsonArray)Typed("query-location-levels", Data())!)[0]![
            "options"
        ]!.AsArray();
        Check(
            letters[26].I("id") == 27 && letters[27].S("value") == "AB",
            "Adding letter options preserves existing identities"
        );
        Reject(() =>
            Typed(
                "location-configure",
                Data(("names", expandedNames), ("options", Object(("1", new[] { "A1" }))))
            )
        );
        Check(
            service.State(typedActor).Map("items")[usedCode].S("bin") == typedChoice.S("bin"),
            "Type configuration never renames saved locations"
        );

        var legacyState = Object(
            ("items", Object((Codes.New(), Object(("warehouse_id", 1), ("bin", "Legacy code")))))
        );
        var appendedTypes = Locations.Configure(
            legacyState,
            Data(
                ("names", new[] { "Location", "Shelf" }),
                ("datatypes", new[] { "text", "number" })
            )
        );
        Check(
            appendedTypes[1].S("datatype") == "number",
            "New typed levels can be appended alongside unstructured legacy locations"
        );
        Reject(() =>
            Locations.Configure(
                legacyState,
                Data(
                    ("names", new[] { "Location", "Shelf" }),
                    ("datatypes", new[] { "number", "number" })
                )
            )
        );

        // Upgrade a real database from the released migration with existing location preferences.
        var folder = Path.Combine(directory, "entity-82");
        Directory.CreateDirectory(folder);
        using (
            var db = new InventoryDbContext(
                InventoryDbContext.OptionsFor(Path.Combine(folder, "state.sqlite3"))
            )
        )
        {
            db.Database.GetService<IMigrator>().Migrate("20261110134136_InitialInventory");
            db.Records.AddRange(
                new InventoryRecord
                {
                    Collection = "metadata",
                    Key = "schema",
                    Document = "2",
                },
                new InventoryRecord
                {
                    Collection = "metadata",
                    Key = "revision",
                    Document = "0",
                },
                new InventoryRecord
                {
                    Collection = "binloc_label_settings",
                    Key = "1",
                    Document = "{\"enabled\":true,\"show\":{\"1\":1}}",
                }
            );
            db.SaveChanges();
        }
        Check(
            repo.Read(82, state => state.Map("location_label_settings")["1"].B("enabled")),
            "EF migration preserves existing location label settings"
        );
        Check(
            new StateRepository(Options.Create(new AppSettings { DataDirectory = directory })).Read(
                80,
                state => state.Map("items")[code].S("bin")
            ) == "A-3",
            "Locations persist across repository restarts"
        );
        return count;
    }
}
