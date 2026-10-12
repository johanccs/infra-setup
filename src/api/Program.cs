using Npgsql;
using Todo.Api.Classes;
using Todo.Api.Services;


var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Todos") 
    ?? throw new InvalidOperationException(
        "Set the connection string 'Todos' (environment variable ConnectionStrings__Todos).");

builder.Services.AddSingleton(NpgsqlDataSource.Create(connectionString));
builder.Services.AddSingleton<TodoStore>();
builder.Services.AddHealthChecks();

var app = builder.Build();

var store = app.Services.GetRequiredService<TodoStore>();
_ = store.ConnectAsync(app.Lifetime.ApplicationStopping);

app.MapGet("/api/info", () => new
{
    Version = Environment.GetEnvironmentVariable("APP_Version") ?? "dev",
    Host = Environment.MachineName
});

var todos = app.MapGroup("/api/todos");

todos.MapGet("/", (TodoStore store) => store.AllAsync());

todos.MapPost("/", async(NewTodo input, TodoStore store) => 
    string.IsNullOrWhiteSpace(input.Title) 
    ? Results.BadRequest(new { error = "Title is required." })
    : Results.Created("/api/todos", await store.AddAsync(input.Title.Trim()))
);

todos.MapPut("/{id:int}/toggle", async (int id, TodoStore store) => 
    await store.ToggleAsync(id) is {} todo ? Results.Ok(todo): Results.NotFound());

todos.MapDelete("/{id:int}", async (int id, TodoStore store) => 
    await store.RemoveAsync(id) ? Results.NoContent() : Results.NotFound());

app.MapHealthChecks("/healthz");

app.MapGet("/readyz", (TodoStore store) => store.Ready ? Results.Text("Ready") : Results.StatusCode(503));

app.Run();

