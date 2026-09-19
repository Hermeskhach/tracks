using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Tracks.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<JournalDb>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Journal")
    ?? throw new InvalidOperationException("Set ConnectionStrings__Journal to a PostgreSQL connection string.")));
builder.Services.AddIdentity<AppUser, IdentityRole>(o => {
    o.User.RequireUniqueEmail = true; o.Password.RequiredLength = 8; o.Lockout.MaxFailedAccessAttempts = 5;
}).AddEntityFrameworkStores<JournalDb>().AddDefaultTokenProviders();
builder.Services.ConfigureApplicationCookie(o => {
    o.Cookie.Name = "tracks.session"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    o.ExpireTimeSpan = TimeSpan.FromDays(14);
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(o => {
    o.RejectionStatusCode = 429;
    o.AddPolicy("auth", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));
});
var app = builder.Build();
app.UseExceptionHandler(handler => handler.Run(async c => {
    c.Response.StatusCode = 500; await c.Response.WriteAsJsonAsync(new { message = "Something went wrong. Please try again." });
}));
app.Use(async (c, next) => {
    c.Response.Headers["X-Content-Type-Options"] = "nosniff";
    c.Response.Headers["Referrer-Policy"] = "no-referrer";
    c.Response.Headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    if (c.Request.Path.StartsWithSegments("/api")) {
        c.Response.Headers.CacheControl = "no-store";
        // Custom headers require a CORS preflight. No cross-origin clients are allowed.
        if (c.Request.Method is not ("GET" or "HEAD" or "OPTIONS") && c.Request.Headers["X-Tracks-Request"] != "1") {
            c.Response.StatusCode = 403; return;
        }
    }
    await next();
});
app.UseRateLimiter(); app.UseAuthentication(); app.UseAuthorization();
app.UseDefaultFiles(); app.UseStaticFiles();
var auth = app.MapGroup("/api/auth").RequireRateLimiting("auth");
auth.MapPost("/register", async (RegisterRequest i, UserManager<AppUser> users, SignInManager<AppUser> signIn) => {
    if (string.IsNullOrWhiteSpace(i.Name) || i.Name.Length > 80 || string.IsNullOrWhiteSpace(i.Email)
        || i.Email.Length > 254 || !new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(i.Email)
        || string.IsNullOrEmpty(i.Password) || i.Password.Length > 128) return Bad("Enter a name, valid email, and password (8–128 characters).");
    var user = new AppUser { UserName = i.Email.Trim(), Email = i.Email.Trim(), DisplayName = i.Name.Trim() };
    var result = await users.CreateAsync(user, i.Password);
    if (!result.Succeeded) return Bad(string.Join(" ", result.Errors.Select(e => e.Description)));
    await signIn.SignInAsync(user, true); return Results.Ok(new { user.DisplayName, user.Email });
});
auth.MapPost("/login", async (LoginRequest i, SignInManager<AppUser> signIn) => {
    if (string.IsNullOrWhiteSpace(i.Email) || string.IsNullOrEmpty(i.Password)) return Results.Unauthorized();
    var result = await signIn.PasswordSignInAsync(i.Email.Trim(), i.Password, true, true);
    return result.Succeeded ? Results.Ok() : Results.Json(new { message = "Unable to sign in. Check your details, or try again later." }, statusCode: 401);
});
auth.MapPost("/logout", async (SignInManager<AppUser> signIn) => { await signIn.SignOutAsync(); return Results.NoContent(); }).RequireAuthorization();
app.MapGet("/api/auth/me", async (ClaimsPrincipal principal, UserManager<AppUser> users) => {
    var user = await users.GetUserAsync(principal);
    return user is null ? Results.Unauthorized() : Results.Ok(new { user.DisplayName, user.Email });
}).RequireAuthorization();
var api = app.MapGroup("/api").RequireAuthorization();
api.MapGet("/projects", async (JournalDb db, ClaimsPrincipal user) => {
    var tracks = await db.Tracks.AsNoTracking().Where(t => t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!).OrderBy(t => t.CreatedAt).ToListAsync();
    var activities = await db.Activities.AsNoTracking().Where(a => a.Track.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!).OrderByDescending(a => a.Date).ThenByDescending(a => a.CreatedAt).ToListAsync();
    return Results.Ok(new { tracks = tracks.Select(ViewTrack), activities = activities.Select(ViewActivity) });
});
api.MapPost("/projects", async (TrackRequest i, JournalDb db, ClaimsPrincipal user) => {
    if (ValidateTrack(i) is string error) return Bad(error);
    var t = new Track { UserId = user.FindFirstValue(ClaimTypes.NameIdentifier)! }; ApplyTrack(t, i); db.Tracks.Add(t); await db.SaveChangesAsync();
    return Results.Created($"/api/projects/{t.Id}", ViewTrack(t));
});
api.MapPut("/projects/{id:guid}", async (Guid id, TrackRequest i, JournalDb db, ClaimsPrincipal user) => {
    var t = await db.Tracks.SingleOrDefaultAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    if (t is null) return Results.NotFound(); if (ValidateTrack(i) is string error) return Bad(error);
    ApplyTrack(t, i); await db.SaveChangesAsync(); return Results.Ok(ViewTrack(t));
});
api.MapDelete("/projects/{id:guid}", async (Guid id, JournalDb db, ClaimsPrincipal user) => {
    var t = await db.Tracks.SingleOrDefaultAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    if (t is null) return Results.NotFound(); t.Archived = true; await db.SaveChangesAsync(); return Results.NoContent();
});
api.MapGet("/projects/{id:guid}/activities", async (Guid id, JournalDb db, ClaimsPrincipal user) => {
    if (!await db.Tracks.AnyAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!)) return Results.NotFound();
    var items = await db.Activities.AsNoTracking().Where(a => a.TrackId == id).OrderByDescending(a => a.Date).ThenByDescending(a => a.CreatedAt).ToListAsync();
    return Results.Ok(items.Select(ViewActivity));
});
api.MapPost("/projects/{id:guid}/activities", async (Guid id, ActivityRequest i, JournalDb db, ClaimsPrincipal user) => {
    var t = await db.Tracks.SingleOrDefaultAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    if (t is null) return Results.NotFound(); if (t.Archived) return Bad("Restore this track before logging an activity.");
    if (ValidateActivity(i) is string error) return Bad(error);
    var a = new Activity { TrackId = id }; ApplyActivity(a, i); db.Activities.Add(a); await db.SaveChangesAsync();
    return Results.Created($"/api/activities/{a.Id}", ViewActivity(a));
});
api.MapPut("/activities/{id:guid}", async (Guid id, ActivityRequest i, JournalDb db, ClaimsPrincipal user) => {
    var a = await db.Activities.Include(a => a.Track).SingleOrDefaultAsync(a => a.Id == id && a.Track.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    if (a is null) return Results.NotFound(); if (a.Track.Archived) return Bad("Restore this track before editing activities.");
    if (ValidateActivity(i) is string error) return Bad(error);
    ApplyActivity(a, i); await db.SaveChangesAsync(); return Results.Ok(ViewActivity(a));
});
api.MapDelete("/activities/{id:guid}", async (Guid id, JournalDb db, ClaimsPrincipal user) => {
    var a = await db.Activities.SingleOrDefaultAsync(a => a.Id == id && a.Track.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    if (a is null) return Results.NotFound(); db.Activities.Remove(a); await db.SaveChangesAsync(); return Results.NoContent();
});
api.MapGet("/projects/{id:guid}/heatmap", async (Guid id, int? year, JournalDb db, ClaimsPrincipal user) => {
    if (!await db.Tracks.AnyAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!)) return Results.NotFound();
    var y = year ?? DateTime.UtcNow.Year; if (y < 1900 || y > 9998) return Bad("Invalid year.");
    var start = new DateOnly(y, 1, 1); var end = start.AddYears(1);
    var counts = await db.Activities.Where(a => a.TrackId == id && a.Date >= start && a.Date < end).GroupBy(a => a.Date).Select(g => new { date = g.Key, count = g.Count() }).ToDictionaryAsync(g => g.date, g => g.count);
    return Results.Ok(Enumerable.Range(0, end.DayNumber - start.DayNumber).Select(n => new { date = start.AddDays(n), count = counts.GetValueOrDefault(start.AddDays(n)) }));
});
api.MapGet("/projects/{id:guid}/share", async (Guid id, JournalDb db, ClaimsPrincipal user) => {
    if (!await db.Tracks.AnyAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!)) return Results.NotFound();
    var s = await db.ShareLinks.AsNoTracking().SingleOrDefaultAsync(s => s.TrackId == id);
    return Results.Ok(new { enabled = s is not null && s.Enabled && (s.ExpiresAt == null || s.ExpiresAt > DateTimeOffset.UtcNow), expiresAt = s?.ExpiresAt });
});
api.MapPost("/projects/{id:guid}/share", async (Guid id, ShareRequest i, JournalDb db, ClaimsPrincipal user) => {
    if (!await db.Tracks.AnyAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!)) return Results.NotFound();
    if (i.ExpiresAt <= DateTimeOffset.UtcNow) return Bad("Choose an expiry in the future.");
    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    var s = await db.ShareLinks.SingleOrDefaultAsync(s => s.TrackId == id);
    if (s is null) { s = new ShareLink { TrackId = id }; db.ShareLinks.Add(s); }
    s.TokenHash = Hash(token); s.Enabled = true; s.ExpiresAt = i.ExpiresAt;
    await db.SaveChangesAsync(); return Results.Ok(new { token, s.ExpiresAt });
});
api.MapDelete("/projects/{id:guid}/share", async (Guid id, JournalDb db, ClaimsPrincipal user) => {
    if (!await db.Tracks.AnyAsync(t => t.Id == id && t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!)) return Results.NotFound();
    var s = await db.ShareLinks.SingleOrDefaultAsync(s => s.TrackId == id);
    if (s is not null) { s.Enabled = false; await db.SaveChangesAsync(); } return Results.NoContent();
});
app.MapGet("/api/shared/{token}", async (string token, JournalDb db) => {
    if (token.Length != 64) return Results.NotFound(); var hash = Hash(token);
    var s = await db.ShareLinks.AsNoTracking().Include(s => s.Track).SingleOrDefaultAsync(s => s.TokenHash == hash && s.Enabled && (s.ExpiresAt == null || s.ExpiresAt > DateTimeOffset.UtcNow));
    if (s is null) return Results.NotFound();
    var items = await db.Activities.AsNoTracking().Where(a => a.TrackId == s.TrackId).OrderByDescending(a => a.Date).ThenByDescending(a => a.CreatedAt).ToListAsync();
    return Results.Ok(new { track = ViewTrack(s.Track), activities = items.Select(ViewActivity) });
});
api.MapPost("/examples", async (DateOnly? today, JournalDb db, ClaimsPrincipal user) => {
    var utcToday = DateOnly.FromDateTime(DateTime.UtcNow);
    if (today.HasValue && Math.Abs(today.Value.DayNumber - utcToday.DayNumber) > 1) return Bad("Invalid local date.");
    if (await db.Tracks.AnyAsync(t => t.UserId == user.FindFirstValue(ClaimTypes.NameIdentifier)!)) return Bad("Example tracks can only be added to an empty journal.");
    SampleData.Add(db, user.FindFirstValue(ClaimTypes.NameIdentifier)!, today ?? utcToday); await db.SaveChangesAsync(); return Results.NoContent();
});
app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");
if (app.Configuration.GetValue<bool>("Database:AutoMigrate")) {
    using var scope = app.Services.CreateScope(); await scope.ServiceProvider.GetRequiredService<JournalDb>().Database.MigrateAsync();
}
app.Run();
static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
static IResult Bad(string message) => Results.BadRequest(new { message });
static object ViewTrack(Track t) => new { t.Id, t.Name, t.Description, t.Icon, t.Color, t.Archived, t.CreatedAt };
static object ViewActivity(Activity a) => new { a.Id, projectId = a.TrackId, a.Date, a.Title, a.Description, a.Value, a.Unit, a.CreatedAt, a.UpdatedAt };
static string? ValidateTrack(TrackRequest i) => string.IsNullOrWhiteSpace(i.Name) || i.Name.Length > 80 ? "Track name must be 1–80 characters."
    : (i.Description?.Length ?? 0) > 500 ? "Description must be at most 500 characters."
    : !new[] { "green", "blue", "purple", "orange", "pink" }.Contains(i.Color) ? "Choose a track color."
    : string.IsNullOrWhiteSpace(i.Icon) || i.Icon.Length > 20 ? "Choose an icon." : null;
static string? ValidateActivity(ActivityRequest i) => string.IsNullOrWhiteSpace(i.Title) || i.Title.Length > 200 ? "Activity title must be 1–200 characters."
    : (i.Description?.Length ?? 0) > 5000 ? "Notes must be at most 5,000 characters."
    : i.Date < new DateOnly(1900, 1, 1) || i.Date > DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)) ? "Choose a valid activity date, no later than today."
    : i.Value is < 0 or > 1000000000 ? "Value must be between 0 and 1 billion."
    : (i.Unit?.Length ?? 0) > 30 || (i.Value.HasValue && string.IsNullOrWhiteSpace(i.Unit)) ? "Add a unit (up to 30 characters)." : null;
static void ApplyTrack(Track t, TrackRequest i) { t.Name = i.Name.Trim(); t.Description = i.Description?.Trim() ?? ""; t.Icon = i.Icon; t.Color = i.Color; t.Archived = i.Archived; }
static void ApplyActivity(Activity a, ActivityRequest i) { a.Date = i.Date; a.Title = i.Title.Trim(); a.Description = i.Description?.Trim() ?? ""; a.Value = i.Value; a.Unit = i.Value.HasValue ? i.Unit?.Trim() : null; a.UpdatedAt = DateTimeOffset.UtcNow; }
public record RegisterRequest(string Name, string Email, string Password);
public record LoginRequest(string Email, string Password);
public record TrackRequest(string Name, string? Description, string Icon, string Color, bool Archived);
public record ActivityRequest(DateOnly Date, string Title, string? Description, decimal? Value, string? Unit);
public record ShareRequest(DateTimeOffset? ExpiresAt);
public partial class Program { }
