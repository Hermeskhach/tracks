using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
namespace Tracks.Api;
public class AppUser : IdentityUser { public string DisplayName { get; set; } = ""; }
public class Track {
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public AppUser User { get; set; } = null!;
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Icon { get; set; } = "✦";
    public string Color { get; set; } = "green";
    public bool Archived { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public class Activity {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TrackId { get; set; }
    public Track Track { get; set; } = null!;
    public DateOnly Date { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal? Value { get; set; }
    public string? Unit { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
public class ShareLink {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TrackId { get; set; }
    public Track Track { get; set; } = null!;
    public string TokenHash { get; set; } = "";
    public bool Enabled { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ExpiresAt { get; set; }
}
public class JournalDb(DbContextOptions<JournalDb> options) : IdentityDbContext<AppUser>(options) {
    public DbSet<Track> Tracks => Set<Track>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<ShareLink> ShareLinks => Set<ShareLink>();
    protected override void OnModelCreating(ModelBuilder b) {
        base.OnModelCreating(b);
        b.Entity<AppUser>().Property(u => u.DisplayName).HasMaxLength(80);
        b.Entity<Track>().Property(t => t.Name).HasMaxLength(80);
        b.Entity<Track>().Property(t => t.Description).HasMaxLength(500);
        b.Entity<Track>().HasIndex(t => new { t.UserId, t.Archived });
        b.Entity<Activity>().Property(a => a.Title).HasMaxLength(200);
        b.Entity<Activity>().Property(a => a.Description).HasMaxLength(5000);
        b.Entity<Activity>().Property(a => a.Unit).HasMaxLength(30);
        b.Entity<Activity>().Property(a => a.Value).HasPrecision(18, 4);
        b.Entity<Activity>().HasIndex(a => new { a.TrackId, a.Date });
        b.Entity<ShareLink>().HasIndex(s => s.TrackId).IsUnique();
        b.Entity<ShareLink>().HasIndex(s => s.TokenHash).IsUnique();
    }
}
