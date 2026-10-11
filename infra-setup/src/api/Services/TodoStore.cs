using System.Data.Common;
using Microsoft.VisualBasic;
using Npgsql;

namespace Todo.Api.Services;

public class TodoStore(NpgsqlDataSource db, ILogger<TodoStore>log)
{
    public bool Ready { get; private set; }

    public async Task ConnectAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await using var cmd = db.CreateCommand(
                "Create table if not exists todos (id serial Primary Key, title text NOT NULL, done boolean NOT NULL Default false)");

                await cmd.ExecuteNonQueryAsync(stop);
                Ready = true;
                log.LogInformation("Connected to the database");
                return;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning("Database not reachable yet ({Message}). Retrying in 2 seconds.", e.Message);
                await Task.Delay(TimeSpan.FromSeconds(2),stop);
            }
        
        }
    }

    public async Task<List<Classes.Todo>>AllAsync()
    {
        await using var cmd = db.CreateCommand("Select id, title, done from todos ORDER BY id");
        await using var rdr = await cmd.ExecuteReaderAsync();

        var list = new List<Classes.Todo>();

        while(await rdr.ReadAsync())
        {
            list.Add(new Classes.Todo(rdr.GetInt32(0), rdr.GetString(1), rdr.GetBoolean(2)));
        }

        return list;
    }

    public async Task<Classes.Todo>AddAsync(string title)
    {
        await using var cmd = db.CreateCommand("Insert into todos (title) VALUES ($1) RETURNING id");
        cmd.Parameters.AddWithValue(title);

        return new Classes.Todo((int) (await cmd.ExecuteScalarAsync())!, title, false);
    }

    public async Task<Classes.Todo?>ToggleAsync(int id)
    {
        await using var cmd = db
                .CreateCommand(
                    "UPDATE todos SET done = NOT done where Id = $1 Returning id, title, done");
        cmd.Parameters.AddWithValue(id);

        await using var rdr = await cmd.ExecuteReaderAsync();
        
        return await rdr.ReadAsync() 
            ? new Classes.Todo(rdr.GetInt32(0), rdr.GetString(1), rdr.GetBoolean(2))
            : null;
    }

    public async Task<bool> RemoveAsync(int id)
    {
        await using var cmd = db.CreateCommand("Delete from todos where Id = $1");
        cmd.Parameters.AddWithValue(id);

        return await cmd.ExecuteNonQueryAsync() > 0;
    }
}
