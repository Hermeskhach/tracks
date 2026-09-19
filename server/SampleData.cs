namespace Tracks.Api;
public static class SampleData {
    public static void Add(JournalDb db, string userId, DateOnly today) {
        var definitions = new[] {
            ("German", "A little closer to fluent, every day.", "🇩🇪", "green", "Practiced articles and sentence structure", 25m, "min", "Worked on der, die, das. The patterns are starting to stick."),
            ("Running", "Fresh air. Clear head. One kilometer at a time.", "↗", "blue", "An easy run around the neighborhood", 3m, "km", "15:42 · Moderate-hard effort. Felt good to get outside."),
            ("Web Agency", "Building a thoughtful, independent business.", "▧", "purple", "Refined the agency positioning", 45m, "min", "Narrowed down the services and prepared networking follow-ups."),
            ("Reading", "Good books, new perspectives.", "▤", "orange", "Read a few chapters", 30m, "pages", "Made a note of a passage to come back to."),
            ("Boxing", "Showing up, getting stronger.", "✳", "pink", "Footwork and bag training", 60m, "min", "Focused on keeping my guard up between combinations.")
        };
        for (var n = 0; n < definitions.Length; n++) {
            var d = definitions[n]; var t = new Track { UserId = userId, Name = d.Item1, Description = d.Item2, Icon = d.Item3, Color = d.Item4 };
            db.Tracks.Add(t);
            var random = new Random(42 + n);
            for (var day = 0; day < 150; day++) {
                if (random.Next(100) > 65 - n * 8 && day > 3) continue;
                if (day == 0 && n > 2) continue;
                db.Activities.Add(new Activity { TrackId = t.Id, Date = today.AddDays(-day), Title = d.Item5, Value = d.Item6, Unit = d.Item7, Description = day == 0 ? d.Item8 : "Example activity — edit or delete to make this journal your own." });
                if (day % 13 == 0 && n == 0) db.Activities.Add(new Activity { TrackId = t.Id, Date = today.AddDays(-day), Title = "Listened to a German podcast", Value = 15, Unit = "min" });
            }
        }
    }
}
