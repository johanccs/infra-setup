// Exercises for steps 16 to 18 (access models, broken access control, Kubernetes RBAC).
// IA.scenarios: each broken and fixed C# snippet is compiled and called over HTTP by tests/identity.test.js.
(function () {
  var IA = window.IA, X = IA.exercises;
  IA.scenarios = IA.scenarios || [];
  var CTX = 'Context for every snippet: the caller is signed in and the token has already been validated (step 20). <code>user</code> is the <code>ClaimsPrincipal</code>, <code>sub</code> is the caller\'s id, and <code>Db</code> holds <code>Todos</code> (each with an <code>Owner</code>) and <code>Users</code>.';

  function scenario(id, o) {
    IA.scenarios.push({ id: id, base: o.base, broken: o.broken, fixed: o.fixed, probes: o.probes });
    X[id] = { kind: 'scenario', intro: o.intro, broken: o.broken.replace(/\{base\}/g, ''), fixed: o.fixed.replace(/\{base\}/g, ''), question: o.question, options: o.options, explain: o.explain, hints: o.hints || [] };
  }

  // ---------------- 17
  scenario('a17-idor', { base: 's1',
    intro: 'Read a todo by its id. ' + CTX,
    broken: 'app.MapGet("{base}/todos/{id:int}", (int id) =>\n    Db.Todos.FirstOrDefault(t => t.Id == id) is { } t ? Results.Ok(t) : Results.NotFound())\n   .RequireAuthorization();',
    fixed: 'app.MapGet("{base}/todos/{id:int}", (int id, ClaimsPrincipal user) =>\n{\n    var me = user.FindFirst("sub")!.Value;\n    return Db.Todos.FirstOrDefault(t => t.Id == id && t.Owner == me) is { } t ? Results.Ok(t) : Results.NotFound();\n}).RequireAuthorization();',
    question: 'Alice is signed in. She asks for <code>/todos/2</code>, which belongs to Bob. What happens, and why?',
    options: [{ t: 'She gets Bob\'s todo. The endpoint checks that she is signed in, never that the todo is hers.', ok: true, why: 'Authentication happened, authorization to <em>this object</em> did not. This is an insecure direct object reference (OWASP API1, BOLA).' }, { t: 'She gets a 403, because <code>RequireAuthorization()</code> blocks other users\' data.', ok: false, why: '<code>RequireAuthorization()</code> only demands a signed-in user.' }, { t: 'She gets a 404, because ids are unique per user.', ok: false, why: 'The ids are global in the store.' }],
    explain: 'Query by id <em>and</em> owner, so a todo that is not yours is indistinguishable from one that does not exist.',
    probes: [{ as: 'alice', method: 'GET', path: '/todos/2', broken: { status: 200, body: /Pay rent/ }, fixed: { status: 404 } }, { as: 'alice', method: 'GET', path: '/todos/1', broken: { status: 200 }, fixed: { status: 200, body: /Buy milk/ } }] });
  scenario('a17-admin', { base: 's2',
    intro: 'Delete a user. The Angular UI only shows the "Delete user" button to admins. ' + CTX,
    broken: 'app.MapDelete("{base}/admin/users/{id}", (string id) =>\n{\n    Db.Users.RemoveAll(u => u.Id == id);\n    return Results.NoContent();\n}).RequireAuthorization();',
    fixed: 'app.MapDelete("{base}/admin/users/{id}", (string id) =>\n{\n    Db.Users.RemoveAll(u => u.Id == id);\n    return Results.NoContent();\n}).RequireAuthorization("Admin");   // policy: RequireRole("admin")',
    question: 'Alice is a normal user. She calls <code>DELETE /admin/users/ghost</code> directly, with <code>curl</code>. What does the broken API answer?',
    options: [{ t: '204: any signed-in user can call it. Hiding the button was the only control.', ok: true, why: 'The UI is a convenience. Only the server can enforce (OWASP: "access control is only effective in trusted server-side code").' }, { t: '403: the route starts with <code>/admin</code>, so ASP.NET Core treats it as protected.', ok: false, why: 'Route names mean nothing to authorization.' }, { t: '401: she is not an admin so she is not authenticated.', ok: false, why: 'She is authenticated. She is not authorized.' }],
    explain: 'Require the role on the endpoint itself, with a named policy, and let the server answer 403 to everyone else.',
    probes: [{ as: 'alice', method: 'DELETE', path: '/admin/users/ghost', broken: { status: 204 }, fixed: { status: 403 } }, { as: 'root', roles: 'admin', method: 'DELETE', path: '/admin/users/ghost2', broken: { status: 204 }, fixed: { status: 204 } }] });
  scenario('a17-owner', { base: 's3',
    intro: 'Create a todo. The client sends the owner it wants. ' + CTX,
    broken: 'app.MapPost("{base}/todos", (NewTodo input) =>\n{\n    var t = new Todo(Db.Todos.Count + 100, input.Owner, input.Title);\n    Db.Todos.Add(t);\n    return Results.Created("/todos/" + t.Id, t);\n}).RequireAuthorization();\n\nrecord NewTodo(string Owner, string Title);',
    fixed: 'app.MapPost("{base}/todos", (NewTodo input, ClaimsPrincipal user) =>\n{\n    var me = user.FindFirst("sub")!.Value;          // the owner comes from the token, never the body\n    var t = new Todo(Db.Todos.Count + 100, me, input.Title);\n    Db.Todos.Add(t);\n    return Results.Created("/todos/" + t.Id, t);\n}).RequireAuthorization();\n\nrecord NewTodo(string Title);',
    question: 'Alice posts <code>{"owner":"bob","title":"Pay Alice"}</code>. What is wrong?',
    options: [{ t: 'The identity comes from the request body, so any caller can create data in anyone\'s name.', ok: true, why: 'Who the caller is must come from the validated token, and never from something the caller types.' }, { t: 'Nothing: the body is JSON, and JSON is validated by the framework.', ok: false, why: 'Binding validates shape, not meaning.' }, { t: 'The id is predictable.', ok: false, why: 'Predictable ids are a smaller problem. The owner field is the flaw.' }],
    explain: 'Take the owner from the token. Remove the field from the input type, so it cannot be supplied.',
    probes: [{ as: 'alice', method: 'POST', path: '/todos', body: '{"owner":"bob","title":"x"}', broken: { status: 201, body: /"owner":"bob"/ }, fixed: { status: 201, body: /"owner":"alice"/ } }] });
  scenario('a17-overpost', { base: 's4',
    intro: 'Let a user change their own profile. ' + CTX,
    broken: 'app.MapPut("{base}/users/me", (AppUser input, ClaimsPrincipal user) =>\n{\n    var me = Db.Users.First(u => u.Id == user.FindFirst("sub")!.Value);\n    me.Name = input.Name;\n    me.IsAdmin = input.IsAdmin;\n    return Results.Ok(me);\n}).RequireAuthorization();',
    fixed: 'app.MapPut("{base}/users/me", (ProfileUpdate input, ClaimsPrincipal user) =>\n{\n    var me = Db.Users.First(u => u.Id == user.FindFirst("sub")!.Value);\n    me.Name = input.Name;                            // only what the caller may change\n    return Results.Ok(me);\n}).RequireAuthorization();\n\nrecord ProfileUpdate(string Name);',
    question: 'Alice sends <code>{"name":"Alice","isAdmin":true}</code>. What does the broken endpoint do?',
    options: [{ t: 'It makes her an administrator: the whole <code>AppUser</code> is bound from the body, including the field she must not control.', ok: true, why: 'This is mass assignment (over-posting): OWASP API3, broken object property level authorization.' }, { t: 'It ignores <code>isAdmin</code> because she is not an admin.', ok: false, why: 'Nothing in the code checks that.' }, { t: 'It rejects the request because the JSON has an unknown field.', ok: false, why: 'The field is known: <code>AppUser</code> has it.' }],
    explain: 'Bind to a type that has only the fields the caller may change.',
    probes: [{ as: 'alice', method: 'PUT', path: '/users/me', body: '{"name":"Alice","isAdmin":true}', broken: { status: 200, body: /"isAdmin":true/ }, fixed: { status: 200, body: /"isAdmin":false/ } }] });
  scenario('a17-verb', { base: 's5',
    intro: 'Read and rename a todo. ' + CTX,
    broken: 'app.MapGet("{base}/todos/{id:int}/title", (int id) => Db.Todos.FirstOrDefault(t => t.Id == id)?.Title ?? "")\n   .RequireAuthorization();\n\napp.MapPut("{base}/todos/{id:int}/title", (int id, TitleUpdate input) =>\n{\n    var i = Db.Todos.FindIndex(t => t.Id == id);\n    if (i < 0) return Results.NotFound();\n    Db.Todos[i] = Db.Todos[i] with { Title = input.Title };\n    return Results.NoContent();\n});\n\nrecord TitleUpdate(string Title);',
    fixed: 'var todos = app.MapGroup("{base}/todos/{id:int}/title").RequireAuthorization();   // one rule for the whole group\n\ntodos.MapGet("", (int id) => Db.Todos.FirstOrDefault(t => t.Id == id)?.Title ?? "");\n\ntodos.MapPut("", (int id, TitleUpdate input) =>\n{\n    var i = Db.Todos.FindIndex(t => t.Id == id);\n    if (i < 0) return Results.NotFound();\n    Db.Todos[i] = Db.Todos[i] with { Title = input.Title };\n    return Results.NoContent();\n});\n\nrecord TitleUpdate(string Title);',
    question: 'An anonymous caller (no token at all) sends <code>PUT /todos/3/title</code>. What happens?',
    options: [{ t: 'It succeeds. The author protected the GET and forgot the PUT: there is no deny-by-default.', ok: true, why: 'An API that lists endpoints one at a time is one omission away from an open door. OWASP: deny by default.' }, { t: '401: the framework protects every endpoint that has an authorized sibling.', ok: false, why: 'Each endpoint is separate.' }, { t: '403: PUT needs a stronger role than GET.', ok: false, why: 'No role is checked anywhere.' }],
    explain: 'Protect the group, so the rule applies to everything inside it, and add a fallback policy so that a new endpoint is closed until someone opens it (step 20).',
    probes: [{ as: null, method: 'PUT', path: '/todos/3/title', body: '{"title":"hacked"}', broken: { status: 204 }, fixed: { status: 401 } }] });
  scenario('a17-role', { base: 's6',
    intro: 'A stats endpoint for admins. ' + CTX,
    broken: 'app.MapGet("{base}/admin/stats", (HttpContext c) =>\n    c.Request.Headers["X-Role"] == "admin"\n        ? Results.Ok(new { todos = Db.Todos.Count })\n        : Results.Forbid())\n   .RequireAuthorization();',
    fixed: 'app.MapGet("{base}/admin/stats", () => Results.Ok(new { todos = Db.Todos.Count }))\n   .RequireAuthorization("Admin");   // the role is in the validated token',
    question: 'Alice (role <code>user</code>) adds the header <code>X-Role: admin</code> to her request. What happens?',
    options: [{ t: 'It returns the stats. The role was read from a header the caller controls.', ok: true, why: 'Anything in the request that the caller can set is not a credential. The role must come from the validated token.' }, { t: 'It returns 403, because her token says <code>user</code>.', ok: false, why: 'The code never looks at the token\'s role.' }, { t: 'It returns 400, an unknown header.', ok: false, why: 'Unknown headers are ignored.' }],
    explain: 'Use the framework\'s role or policy check, which reads the roles from the validated token.',
    probes: [{ as: 'alice', hdr: { 'X-Role': 'admin' }, method: 'GET', path: '/admin/stats', broken: { status: 200, body: /"todos"/ }, fixed: { status: 403 } }] });
  scenario('a17-leak', { base: 's7',
    intro: 'Read a todo, and say why you cannot. ' + CTX,
    broken: 'app.MapGet("{base}/todos/{id:int}", (int id, ClaimsPrincipal user) =>\n{\n    var t = Db.Todos.FirstOrDefault(x => x.Id == id);\n    if (t is null) return Results.NotFound();\n    return t.Owner == user.FindFirst("sub")!.Value ? Results.Ok(t) : Results.Forbid();\n}).RequireAuthorization();',
    fixed: 'app.MapGet("{base}/todos/{id:int}", (int id, ClaimsPrincipal user) =>\n{\n    var me = user.FindFirst("sub")!.Value;\n    var t = Db.Todos.FirstOrDefault(x => x.Id == id && x.Owner == me);\n    return t is null ? Results.NotFound() : Results.Ok(t);   // not yours looks the same as not there\n}).RequireAuthorization();',
    question: 'This one blocks other users\' todos. What does it still give away?',
    options: [{ t: 'It tells an attacker which ids exist: 403 means "there is one, not yours", 404 means "no such id".', ok: true, why: 'RFC 9110 lets a server answer 404 to hide a resource from someone who may not know of it.' }, { t: 'Nothing: 403 is the correct code for "not allowed".', ok: false, why: 'It is correct as a code, but it confirms the object exists.' }, { t: 'It leaks the owner\'s name in the 403.', ok: false, why: 'Nothing in the response names the owner.' }],
    explain: 'For objects, make "not yours" and "not there" the same answer. Use 403 for <em>functions</em> a caller may not use, where nothing is revealed.',
    probes: [{ as: 'alice', method: 'GET', path: '/todos/2', broken: { status: 403 }, fixed: { status: 404 } }, { as: 'alice', method: 'GET', path: '/todos/999', broken: { status: 404 }, fixed: { status: 404 } }] });
  scenario('a17-list', { base: 's8',
    intro: 'List my todos. ' + CTX,
    broken: 'app.MapGet("{base}/todos", () => Db.Todos).RequireAuthorization();',
    fixed: 'app.MapGet("{base}/todos", (ClaimsPrincipal user) =>\n{\n    var me = user.FindFirst("sub")!.Value;\n    return Db.Todos.Where(t => t.Owner == me);\n}).RequireAuthorization();',
    question: 'Alice calls <code>GET /todos</code>. What does she get?',
    options: [{ t: 'Everyone\'s todos. The list has no filter by owner.', ok: true, why: 'The same mistake as the single-object version, in the list. OWASP: model access controls should enforce record ownership.' }, { t: 'Only her todos: the endpoint is called "my todos".', ok: false, why: 'Names do not filter data.' }, { t: 'An empty list, because she has no role.', ok: false, why: 'No role is checked.' }],
    explain: 'Filter every query by the owner taken from the token, so a forgotten check cannot widen the result.',
    probes: [{ as: 'alice', method: 'GET', path: '/todos', broken: { status: 200, body: /Pay rent/ }, fixed: { status: 200, body: /Buy milk/, notBody: /Pay rent/ } }] });

  // ---------------- 16: access models
  X['a16-rules'] = { kind: 'sort', prompt: '<p>Which model is each rule an example of?</p>',
    groups: ['ACL (a list on the resource)', 'RBAC (by role)', 'ABAC (by attributes)', 'ReBAC (by relationship)'],
    items: [
      { t: 'This document lists alice, bob and carol as the people who may open it.', g: 0, why: 'The resource carries its own list of who may do what.' },
      { t: 'Members of the <code>editor</code> role may create todos.', g: 1, why: 'Permissions belong to a role, and people are given the role.' },
      { t: 'A manager may approve an expense if it is under 500 and in their own department.', g: 2, why: 'The decision depends on attributes of the user, the object and the request.' },
      { t: 'Anyone who is a member of the team that owns the folder may edit the files in it.', g: 3, why: 'Access follows a relationship: member of team, team owns folder, folder contains file.' },
      { t: 'Access to the payroll report is allowed on weekdays from the office network only.', g: 2, why: 'An environmental attribute (time, network) is part of the rule.' },
    ] };
  X['a16-scopes'] = { kind: 'quiz', prompt: '<p>Alice (role <code>admin</code>) uses a third-party app. The app\'s access token has the scope <code>todos.read</code> only. The app calls <code>DELETE /todos/5</code>. What should the API do?</p>',
    options: [
      { t: 'Allow it: Alice is an admin, so any token for Alice may delete.', ok: false, why: 'The token is limited to what the user delegated to <em>this app</em>.' },
      { t: 'Refuse it: the token\'s scope does not include deleting, even though Alice\'s role would allow it. Both the user\'s permissions and the token\'s scope must allow the call.', ok: true, why: 'The effective permission is the intersection of what the user may do and what the token was granted.' },
      { t: 'Allow it if the scope is <code>openid</code>.', ok: false, why: '<code>openid</code> is about identity, not about deleting todos.' },
    ] };
  X['a16-rbac'] = { kind: 'rbac', prompt: '<p>Design the permissions of three roles so that every case below comes out as shown. The user-to-role assignments are fixed. A permission ending in <code>:own</code> applies only to todos the caller owns.</p>',
    roleNames: ['viewer', 'editor', 'admin'], perms: ['todos:read', 'todos:create', 'todos:delete', 'todos:delete:own', 'users:manage'],
    users: { vera: ['viewer'], erin: ['editor'], adam: ['admin'], nell: [] },
    cases: [
      { label: '<b>vera</b> reads a todo', user: 'vera', perm: 'todos:read', expect: true },
      { label: '<b>vera</b> creates a todo', user: 'vera', perm: 'todos:create', expect: false },
      { label: '<b>erin</b> creates a todo', user: 'erin', perm: 'todos:create', expect: true },
      { label: '<b>erin</b> deletes her own todo', user: 'erin', perm: 'todos:delete', owner: 'erin', expect: true },
      { label: '<b>erin</b> deletes vera\'s todo', user: 'erin', perm: 'todos:delete', owner: 'vera', expect: false },
      { label: '<b>adam</b> deletes vera\'s todo', user: 'adam', perm: 'todos:delete', owner: 'vera', expect: true },
      { label: '<b>adam</b> manages users', user: 'adam', perm: 'users:manage', expect: true },
      { label: '<b>erin</b> manages users', user: 'erin', perm: 'users:manage', expect: false },
      { label: '<b>nell</b> (no role) reads a todo', user: 'nell', perm: 'todos:read', expect: false },
    ],
    answer: { viewer: ['todos:read'], editor: ['todos:read', 'todos:create', 'todos:delete:own'], admin: ['todos:read', 'todos:create', 'todos:delete', 'users:manage'] },
    hints: ['Start with the cases that must be allowed, and give each role only what those cases need.', 'Erin may delete only her own todos: that is <code>todos:delete:own</code>, not <code>todos:delete</code>.'] };
  X['a16-sod'] = { kind: 'quiz', prompt: '<p>In a payments system, one person may <b>create</b> a payment and another must <b>approve</b> it. Two roles exist: <code>clerk</code> (create) and <code>approver</code> (approve). A user is given both. What principle does that break, and how is it normally handled?</p>',
    options: [
      { t: 'Separation of duty. The system should forbid one person approving a payment they created, whichever roles they hold.', ok: true, why: 'Roles alone cannot say "not the same person". It needs a rule that looks at the object: attribute or relationship based.' },
      { t: 'Least privilege. Remove the <code>approver</code> role from everyone.', ok: false, why: 'Least privilege is about not granting more than needed. The point here is the combination, and the same person.' },
      { t: 'Nothing, a user may hold any combination of roles.', ok: false, why: 'Combinations of roles are exactly where fraud lives.' },
    ] };

  // ---------------- 18: Kubernetes
  X['a18-role'] = { kind: 'k8srole', prompt: '<p>The service account <code>todo-reporter</code> in the namespace <code>todo</code> must be able to <b>list and get pods</b> in <code>todo</code> and <b>read the one ConfigMap named <code>todo-settings</code></b>. It must do nothing else. Write the Role (the binding already exists).</p>',
    namespace: 'todo', subject: { kind: 'ServiceAccount', name: 'todo-reporter', namespace: 'todo' },
    starter: 'apiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: reporter\n  namespace: todo\nrules:\n  - apiGroups: [""]\n    resources: []\n    verbs: []\n',
    cases: [
      { label: '<code>get pods</code> in todo', request: { verb: 'get', resource: 'pods', group: '', namespace: 'todo' }, expect: true },
      { label: '<code>list pods</code> in todo', request: { verb: 'list', resource: 'pods', group: '', namespace: 'todo' }, expect: true },
      { label: '<code>delete pods</code> in todo', request: { verb: 'delete', resource: 'pods', group: '', namespace: 'todo' }, expect: false },
      { label: '<code>get configmaps todo-settings</code> in todo', request: { verb: 'get', resource: 'configmaps', group: '', namespace: 'todo', name: 'todo-settings' }, expect: true },
      { label: '<code>get configmaps other</code> in todo', request: { verb: 'get', resource: 'configmaps', group: '', namespace: 'todo', name: 'other' }, expect: false },
      { label: '<code>get secrets db</code> in todo', request: { verb: 'get', resource: 'secrets', group: '', namespace: 'todo', name: 'db' }, expect: false },
      { label: '<code>list pods</code> in <b>kube-system</b>', request: { verb: 'list', resource: 'pods', group: '', namespace: 'kube-system' }, expect: false },
      { label: '<code>get deployments</code> (apps) in todo', request: { verb: 'get', resource: 'deployments', group: 'apps', namespace: 'todo' }, expect: false },
    ],
    answer: { rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] }, { apiGroups: [''], resources: ['configmaps'], resourceNames: ['todo-settings'], verbs: ['get'] }] },
    answerYaml: 'apiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: reporter\n  namespace: todo\nrules:\n  - apiGroups: [""]\n    resources: ["pods"]\n    verbs: ["get", "list"]\n  - apiGroups: [""]\n    resources: ["configmaps"]\n    resourceNames: ["todo-settings"]\n    verbs: ["get"]\n',
    hints: ['Two rules: one for pods and one for the ConfigMap.', 'To limit a rule to one object, add <code>resourceNames: ["todo-settings"]</code>.', 'The core API group is written as the empty string <code>""</code>.'] };
  X['a18-binding'] = { kind: 'sort', prompt: '<p>The cluster has a <b>ClusterRole</b> <code>pod-reader</code>. What can a subject do after each kind of binding?</p>',
    groups: ['Read pods in one namespace only', 'Read pods in every namespace'],
    items: [
      { t: 'A <b>RoleBinding</b> in namespace <code>todo</code> that refers to the ClusterRole <code>pod-reader</code>.', g: 0, why: 'A RoleBinding grants permissions only inside its own namespace, even when it refers to a ClusterRole.' },
      { t: 'A <b>ClusterRoleBinding</b> to the ClusterRole <code>pod-reader</code>.', g: 1, why: 'A ClusterRoleBinding grants access cluster-wide.' },
      { t: 'A <b>RoleBinding</b> in namespace <code>staging</code> to the same ClusterRole.', g: 0, why: 'Same: only the namespace of the binding.' },
    ] };
  X['a18-additive'] = { kind: 'quiz', prompt: '<p>A user has a RoleBinding that grants <code>get secrets</code> in <code>todo</code>. You add a second Role that "denies" <code>get secrets</code> for them. What happens?</p>',
    options: [
      { t: 'The deny wins, because it was added last.', ok: false, why: 'There are no deny rules in Kubernetes RBAC.' },
      { t: 'There is no way to write a deny. Permissions are purely additive, so the user can still get secrets until the first binding is removed.', ok: true, why: 'The documentation says it exactly: permissions are purely additive; there are no "deny" rules.' },
      { t: 'The API rejects the second Role as a conflict.', ok: false, why: 'Roles never conflict, because they only add.' },
    ] };
  X['a18-escalate'] = { kind: 'quiz', prompt: '<p>The user <code>dev-lead</code> may create Roles in the namespace <code>todo</code>, but has no permission to read Secrets there. They try to create a Role that grants <code>get secrets</code> and bind it to themselves. What does Kubernetes do?</p>',
    options: [
      { t: 'It refuses: a role can only be created or updated by someone who already holds every permission in it (or has the <code>escalate</code> verb), at the same scope.', ok: true, why: 'This is privilege escalation prevention, enforced by the RBAC API itself.' },
      { t: 'It allows it, because creating Roles is the permission they were given.', ok: false, why: 'Creating Roles does not let you grant what you do not hold.' },
      { t: 'It allows the Role but ignores the binding.', ok: false, why: 'The Role itself is refused.' },
    ] };
  X['a18-sa'] = { kind: 'inspect', prompt: '<p>A pod\'s projected service account token (made-up values), decoded. Answer.</p>',
    artifact: '{\n  "iss": "https://oidc.eks.eu-west-1.amazonaws.com/id/EXAMPLED539D4633E53DE1B71EXAMPLE",\n  "sub": "system:serviceaccount:todo:todo-reporter",\n  "aud": ["sts.amazonaws.com"],\n  "exp": 1791897600,\n  "iat": 1791894000,\n  "kubernetes.io": {\n    "namespace": "todo",\n    "serviceaccount": { "name": "todo-reporter" },\n    "pod": { "name": "reporter-7d9c5" }\n  }\n}',
    parts: [
      { kind: 'quiz', prompt: 'Who is this token about?', options: [{ t: 'The service account <code>todo-reporter</code> in the namespace <code>todo</code>.', ok: true, why: 'That is the <code>sub</code>: <code>system:serviceaccount:&lt;namespace&gt;:&lt;name&gt;</code>.' }, { t: 'The node the pod runs on.', ok: false, why: 'The subject is the service account.' }] },
      { kind: 'quiz', prompt: 'Who is the token <em>for</em>?', options: [{ t: 'AWS STS: <code>aud</code> is <code>sts.amazonaws.com</code>.', ok: true, why: 'A token with the right audience for AWS is useless to the Kubernetes API server, and the reverse.' }, { t: 'The Kubernetes API server.', ok: false, why: 'The default audience is the API server, but this token was asked for another audience.' }] },
      { kind: 'quiz', prompt: 'What must AWS check before giving temporary credentials?', options: [{ t: 'That the token is signed by the cluster\'s OIDC issuer, and that <code>iss</code>, <code>aud</code> and <code>sub</code> match the role\'s trust policy.', ok: true, why: 'The same checks as step 10, against the cluster\'s published keys.' }, { t: 'Nothing: tokens from inside a cluster are trusted.', ok: false, why: 'Anyone can run a cluster. AWS trusts only the issuer you registered.' }] },
    ] };

  X['a17-concept'] = { kind: 'quiz', prompt: '<p>A team keeps shipping endpoints with no authorization check, because it is easy to forget. Which single change makes the <em>default</em> safe?</p>',
    options: [
      { t: 'Add a code review checklist item reminding people to add <code>[Authorize]</code>.', ok: false, why: 'A reminder depends on remembering, which is what failed.' },
      { t: 'Set a fallback authorization policy that requires an authenticated user, so an endpoint with no policy is closed until someone opens it on purpose.', ok: true, why: 'Deny by default. A forgotten check becomes a visible 401, not a hidden hole.' },
      { t: 'Hide the endpoints that matter from the Swagger page.', ok: false, why: 'Hiding is not access control. Anyone can send the request.' },
    ] };
  function drill(id, prompt, specs, answer, hints, after) { IA.cmds[id] = { prompt: prompt, specs: specs, answer: answer, hints: hints || [], after: after || '', run: { noRun: 'needs a cluster' } }; }
  var S = function (cmd, o) { return window.IACmdSpec.spec(IA.cmdFlags, cmd, o); };
  var pos = function (re, label, what, hint) { return { match: re, label: label, what: what, hint: hint }; };
  var SA = /^system:serviceaccount:todo:todo-reporter$/;
  IA.cmds = IA.cmds || {};
  drill('a18-canI', '<p>Ask whether the service account <code>todo-reporter</code> (namespace <code>todo</code>) may <b>list pods</b> in the namespace <code>todo</code>, without becoming it.</p>',
    S('kubectl auth can-i', { what: 'ask the API server whether an action is allowed', need: { '--as': { value: SA, what: 'ask as this identity', bad: function () { return 'A service account is named <code>system:serviceaccount:&lt;namespace&gt;:&lt;name&gt;</code>.'; } }, '--namespace': { value: /^todo$/, what: 'in this namespace' } }, pos: [pos(/^list$/, 'the verb', 'what action', 'list'), pos(/^pods$/, 'the resource', 'on what', 'pods')] }),
    'kubectl auth can-i list pods --as system:serviceaccount:todo:todo-reporter --namespace todo',
    ['The command is <code>kubectl auth can-i VERB RESOURCE</code>.', 'A service account\'s user name is <code>system:serviceaccount:todo:todo-reporter</code>. Pass it with <code>--as</code>.'], 'It answers <code>yes</code> or <code>no</code> (and sets the exit code). Run it for the actions that must be refused too.');
  drill('a18-list', '<p>List <b>everything</b> that <code>todo-reporter</code> may do in the namespace <code>todo</code>.</p>',
    S('kubectl auth can-i', { what: 'ask the API server what is allowed', need: { '--list': { value: false, what: 'list every allowed action' }, '--as': { value: SA, what: 'ask as this identity' }, '--namespace': { value: /^todo$/, what: 'in this namespace' } } }),
    'kubectl auth can-i --list --as system:serviceaccount:todo:todo-reporter --namespace todo',
    ['Instead of a verb and a resource, one flag lists them all.'], 'Read the table as a review: anything you did not expect is a grant to question.');
  drill('a18-create', '<p>Create the Role <code>reporter</code> from the command line, in the namespace <code>todo</code>, allowing the verbs <code>get</code> and <code>list</code> on <code>pods</code>.</p>',
    S('kubectl create role', { what: 'create a Role', need: { '--verb': { value: true, repeat: true, what: 'an allowed verb', each: [{ match: /^get(,list)?$|^get$/, missing: 'Allow <code>get</code>: <code>--verb=get</code>.' }, { match: /^list$|^get,list$|^list,get$/, missing: 'Allow <code>list</code> too: <code>--verb=list</code>.' }] }, '--resource': { value: /^pods$/, what: 'on this kind of object' }, '--namespace': { value: /^todo$/, what: 'in this namespace' } }, pos: [pos(/^reporter$/, 'the Role name', 'what to call it', 'reporter')] }),
    'kubectl create role reporter --verb=get --verb=list --resource=pods --namespace todo',
    ['<code>kubectl create role NAME --verb=… --resource=…</code>. The verb flag can be repeated.'], 'Add <code>--dry-run=client -o yaml</code> to print the YAML instead of creating it: a quick way to start a manifest.');
})();
