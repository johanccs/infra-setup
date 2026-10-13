// Access control models for the lessons of level 5: a small RBAC decision with an ownership rule (step 16) and a model of
// Kubernetes RBAC's documented rules (step 18). Pure JavaScript with no DOM.
// Kubernetes semantics follow kubernetes.io "Using RBAC Authorization": permissions are purely additive (no deny rules);
// a Role is namespaced and a ClusterRole is not; a RoleBinding grants within its namespace and a ClusterRoleBinding cluster-wide;
// an empty resourceNames means everything is allowed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IAAuthz = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- RBAC with an ownership rule
  // model: { roles: { name: ['todos:read', 'todos:delete:own', ...] }, users: { alice: ['editor'] } }
  // request: { user, perm: 'todos:delete', owner: 'alice' | undefined }
  // A permission ending in ':own' applies only when the resource's owner is the caller.
  function decide(model, req) {
    const roles = (model.users && model.users[req.user]) || [];
    const via = [];
    for (const r of roles) {
      const perms = (model.roles && model.roles[r]) || [];
      if (perms.includes(req.perm)) via.push({ role: r, perm: req.perm });
      else if (perms.includes(req.perm + ':own') && req.owner !== undefined && req.owner === req.user) via.push({ role: r, perm: req.perm + ':own' });
    }
    if (via.length) return { allow: true, via, why: `Allowed: role ${via[0].role} grants ${via[0].perm}.` };
    const near = roles.find((r) => ((model.roles && model.roles[r]) || []).includes(req.perm + ':own'));
    if (near) return { allow: false, via: [], why: `Denied: role ${near} grants ${req.perm} only on the caller's own resources, and this one belongs to ${req.owner === undefined ? 'nobody' : req.owner}.` };
    return { allow: false, via: [], why: roles.length ? `Denied: none of ${roles.join(', ')} grants ${req.perm}. Access is denied by default.` : `Denied: ${req.user} has no role. Access is denied by default.` };
  }

  // ---------------------------------------------------------------- Kubernetes RBAC
  const subjectName = (s) => (s.kind === 'ServiceAccount' ? `system:serviceaccount:${s.namespace || 'default'}:${s.name}` : s.name);
  function ruleMatches(rule, a) {
    const has = (list, v) => Array.isArray(list) && (list.includes(v) || list.includes('*'));
    if (!has(rule.apiGroups, a.group)) return false;
    if (!has(rule.resources, a.resource)) return false;
    if (!has(rule.verbs, a.verb)) return false;
    if (rule.resourceNames && rule.resourceNames.length && !rule.resourceNames.includes(a.name)) return false;
    return true;
  }
  // world: { roles: [ { kind: 'Role'|'ClusterRole', name, namespace?, rules: [...] } ], bindings: [ { kind, namespace?, roleRef: { kind, name }, subjects: [...] } ] }
  // who: { kind: 'User'|'ServiceAccount'|'Group', name, namespace?, groups?: [] }; a: { verb, resource, group ('' = core), namespace, name? }
  function k8sCan(world, who, a) {
    const me = subjectName(who);
    for (const b of world.bindings || []) {
      const mine = (b.subjects || []).some((s) => (s.kind === 'Group' ? (who.groups || []).includes(s.name) : subjectName(s) === me && s.kind === who.kind));
      if (!mine) continue;
      if (b.kind === 'RoleBinding' && b.namespace !== a.namespace) continue;       // a RoleBinding grants within its own namespace only
      const role = (world.roles || []).find((r) => r.kind === b.roleRef.kind && r.name === b.roleRef.name && (r.kind === 'ClusterRole' || r.namespace === b.namespace));
      if (!role) continue;
      for (const rule of role.rules || []) if (ruleMatches(rule, a)) return { allow: true, via: `${b.kind} ${b.namespace ? b.namespace + '/' : ''}${b.roleRef.name}` };
    }
    return { allow: false, via: null };
  }
  return { decide, k8sCan, ruleMatches, subjectName };
});
