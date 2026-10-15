// Owned by one authenticated session; navigation does not cancel shared work.
export function createAltasCache() {
  let value = null;
  let pending = null;
  return {
    peek: () => value,
    load(fetcher, refresh = false) {
      if (pending) return pending;
      if (value && !refresh) return Promise.resolve(value);
      pending = Promise.resolve().then(fetcher).then(result => {
        if (!result.success && !result.data) throw new Error('OmniVista no confirmó la consulta.');
        const data = result.data || {};
        value = { users: Array.isArray(data.users) ? data.users : [], sources: data.sources || {}, loading: false, error: '', updatedAt: new Date().toISOString() };
        return value;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
