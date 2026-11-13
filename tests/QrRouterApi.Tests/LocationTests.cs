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
