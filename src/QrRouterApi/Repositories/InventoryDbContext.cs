using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace QrRouterApi.Repositories;

public sealed class InventoryDbContext(DbContextOptions<InventoryDbContext> options)
    : DbContext(options)
{
    public DbSet<InventoryRecord> Records => Set<InventoryRecord>();
    public DbSet<AuditEntry> History => Set<AuditEntry>();

    public static DbContextOptions<InventoryDbContext> OptionsFor(string path) =>
        new DbContextOptionsBuilder<InventoryDbContext>()
            .UseSqlite(
                new SqliteConnectionStringBuilder
                {
                    DataSource = path,
                    Pooling = false,
                    DefaultTimeout = 30,
                }.ToString()
            )
            .Options;

    protected override void OnModelCreating(ModelBuilder model)
    {
        var record = model.Entity<InventoryRecord>();
        record.ToTable(
            "records",
            table => table.HasCheckConstraint("records_json", "json_valid(document)")
        );
        record.HasKey(row => new { row.Collection, row.Key });
        record.Property(row => row.Collection).HasColumnName("collection");
        record.Property(row => row.Key).HasColumnName("key");
        record.Property(row => row.Document).HasColumnName("document");
        record
            .Property(row => row.WarehouseId)
            .HasColumnName("warehouse_id")
            .HasComputedColumnSql(
                "CASE WHEN collection = 'items' THEN COALESCE(json_extract(document, '$.warehouse_id'), 0) END",
                stored: true
            );
        record
            .HasIndex(row => new { row.Collection, row.WarehouseId })
            .HasDatabaseName("records_warehouse");
        var history = model.Entity<AuditEntry>();
        history.ToTable(
            "history",
            table => table.HasCheckConstraint("history_json", "json_valid(document)")
        );
        history.HasKey(row => row.Id);
        history.Property(row => row.Id).HasColumnName("id");
        history.Property(row => row.Document).HasColumnName("document");
    }
}

public sealed class InventoryRecord
{
    public string Collection { get; set; } = "";
    public string Key { get; set; } = "";
    public string Document { get; set; } = "";
    public int? WarehouseId { get; private set; }
}

public sealed class AuditEntry
{
    public long Id { get; set; }
    public string Document { get; set; } = "";
}
