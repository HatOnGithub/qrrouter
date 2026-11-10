using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QrRouterApi.Migrations
{
    /// <inheritdoc />
    public partial class InitialInventory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "history",
                columns: table => new
                {
                    id = table
                        .Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    document = table.Column<string>(type: "TEXT", nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_history", x => x.id);
                    table.CheckConstraint("history_json", "json_valid(document)");
                }
            );

            migrationBuilder.CreateTable(
                name: "records",
                columns: table => new
                {
                    collection = table.Column<string>(type: "TEXT", nullable: false),
                    key = table.Column<string>(type: "TEXT", nullable: false),
                    document = table.Column<string>(type: "TEXT", nullable: false),
                    warehouse_id = table.Column<int>(
                        type: "INTEGER",
                        nullable: true,
                        computedColumnSql: "CASE WHEN collection = 'items' THEN COALESCE(json_extract(document, '$.warehouse_id'), 0) END",
                        stored: true
                    ),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_records", x => new { x.collection, x.key });
                    table.CheckConstraint("records_json", "json_valid(document)");
                }
            );

            migrationBuilder.CreateIndex(
                name: "records_warehouse",
                table: "records",
                columns: new[] { "collection", "warehouse_id" }
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "history");

            migrationBuilder.DropTable(name: "records");
        }
    }
}
