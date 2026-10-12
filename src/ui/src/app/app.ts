import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

interface Todo { id: number; title: string; done: boolean; }
interface Info { version: string; host: string; }

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);

  readonly todos = signal<Todo[]>([]);
  readonly info = signal<Info | null>(null);
  readonly newTitle = signal('');

  ngOnInit(): void {
    this.http.get<Info>('/api/info').subscribe(i => this.info.set(i));
    this.load();
  }

  load(): void {
    this.http.get<Todo[]>('/api/todos').subscribe(t => this.todos.set(t));
  }

  add(): void {
    const title = this.newTitle().trim();
    if (!title) return;
    this.http.post<Todo>('/api/todos', { title }).subscribe(() => {
      this.newTitle.set('');
      this.load();
    });
  }

  toggle(todo: Todo): void {
    this.http.put(`/api/todos/${todo.id}/toggle`, {}).subscribe(() => this.load());
  }

  remove(todo: Todo): void {
    this.http.delete(`/api/todos/${todo.id}`).subscribe(() => this.load());
  }
}