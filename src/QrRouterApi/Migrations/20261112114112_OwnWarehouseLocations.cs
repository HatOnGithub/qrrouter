using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace QrRouterApi.Migrations
{
    /// <inheritdoc />
    public partial class OwnWarehouseLocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE records SET collection='location_label_settings' WHERE collection='binloc_label_settings'"
            );
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE records SET collection='binloc_label_settings' WHERE collection='location_label_settings'"
            );
        }
    }
}
