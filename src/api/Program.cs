using System.ComponentModel;
using System.Diagnostics.Metrics;
using System.Dynamic;
using System.Globalization;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using Todo.Api.Classes;
using Todo.Api.Services;


var faultRate = double.TryParse(Environment.GetEnvironmentVariable("FAULT_RATE"),
    CultureInfo.InvariantCulture, out var f) ? f : 0;

var slowMs = int.TryParse(Environment.GetEnvironmentVariable("SLOW_MS"), out var s) ? s : 0;

var memoryHogMb = int.TryParse(Environment.GetEnvironmentVariable("MEMORY_HOG_MB"), out var m) ? m : 0;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Todos")
    ?? throw new InvalidOperationException(
        "Set the connection string 'Todos' (environment variable ConnectionStrings__Todos).");

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();

builder.Services.AddSingleton(NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton<TodoStore>();
builder.Services.AddHealthChecks();


builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("todo-api"))
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddMeter(TodoMetrics.MeterName)
        .AddPrometheusExporter());

var app = builder.Build();

// Used for experimenting with high memory. Not normal code
// can remove later
for (int i = 0; i < memoryHogMb; i++)
{
    var block = new byte[1024 * 1024];
    Array.Fill(block, (byte)1);
    MemoryHog.Blocks.Add(block);
}

var store = app.Services.GetRequiredService<TodoStore>();
_ = store.ConnectAsync(app.Lifetime.ApplicationStopping);

app.MapGet("/api/info", () => new
{
    Version = Environment.GetEnvironmentVariable("APP_Version") ?? "dev",
    Host = Environment.MachineName
});

var todos = app.MapGroup("/api/todos");

// Drills 1 and 2 - Obs
todos.AddEndpointFilter(async (context, next) =>
{
    if (slowMs > 0) await Task.Delay(slowMs);

    if (Random.Shared.NextDouble() < faultRate)
    {
        app.Logger.LogError("Injected fault on {Method} {Path}",
            context.HttpContext.Request.Method, context.HttpContext.Request.Path);

        return Results.Problem("Injected Fault", statusCode: 500);
    }
    return await next(context);
});

todos.MapGet("/", (TodoStore store) =>
{
       //return store.AllAsync();
        //Testing
        throw new Exception("Test random exceptions for metrices");
});
    
    

todos.MapPost("/", async (NewTodo input, TodoStore store) =>
{
    if (string.IsNullOrWhiteSpace(input.Title))
        return Results.BadRequest(new { error = "Title is required." });

    var todo = await store.AddAsync(input.Title.Trim());

    TodoMetrics.Created.Add(1);

    return Results.Created("api/todos", todo);
});

todos.MapPut("/{id:int}/toggle", async (int id, TodoStore store) =>
    await store.ToggleAsync(id) is { } todo ? Results.Ok(todo) : Results.NotFound());

todos.MapDelete("/{id:int}", async (int id, TodoStore store) =>
    await store.RemoveAsync(id) ? Results.NoContent() : Results.NotFound());

app.MapHealthChecks("/healthz");

app.MapGet("/readyz", (TodoStore store) => store.Ready ? Results.Text("Ready") : Results.StatusCode(503));

app.MapPrometheusScrapingEndpoint();

app.Run();

#region 

static class TodoMetrics
{
    public const string MeterName = "Todo.Api";
    private static readonly Meter Meter = new Meter(MeterName);

    public static readonly Counter<long> Created = 
        Meter.CreateCounter<long>("todos.created", description: "Todos started");
}

static class MemoryHog
{
    public static readonly List<byte[]>Blocks = new();
}

#endregion