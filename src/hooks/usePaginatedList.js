import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPageCache, savePageCache } from '../services/offlineCache.service';

export function usePaginatedList({
  tenantId,
  pageSize,
  offlineMode,
  cacheNamespace,
  fetchPage,
  initialFilters = {},
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cacheInfo, setCacheInfo] = useState(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((total || 0) / (Number(pageSize) || 20))),
    [total, pageSize],
  );

  const loadPage = useCallback(
    async (nextPage = page, nextFilters = filters) => {
      if (!tenantId || !fetchPage) return;

      setLoading(true);
      setError('');

      if (offlineMode) {
        const cached = await getPageCache({
          namespace: cacheNamespace,
          tenantId,
          page: nextPage,
          pageSize,
          filters: nextFilters,
        });

        if (cached) {
          setItems(cached.items || []);
          setTotal(Number(cached.total || 0));
          setCacheInfo({ source: 'cache', cachedAt: cached.cachedAt || null });
          setLoading(false);
          return;
        }

        setItems([]);
        setTotal(0);
        setError('No hay cache local para este listado/filtro en modo offline.');
        setCacheInfo({ source: 'cache-miss', cachedAt: null });
        setLoading(false);
        return;
      }

      const result = await fetchPage({
        tenantId,
        page: nextPage,
        pageSize,
        filters: nextFilters,
      });

      if (!result?.success) {
        const fallback = await getPageCache({
          namespace: cacheNamespace,
          tenantId,
          page: nextPage,
          pageSize,
          filters: nextFilters,
        });

        if (fallback) {
          setItems(fallback.items || []);
          setTotal(Number(fallback.total || 0));
          setError(result?.error || 'Sin conexión. Mostrando cache local.');
          setCacheInfo({ source: 'cache', cachedAt: fallback.cachedAt || null });
        } else {
          setItems([]);
          setTotal(0);
          setError(result?.error || 'No fue posible cargar listado.');
          setCacheInfo({ source: 'none', cachedAt: null });
        }

        setLoading(false);
        return;
      }

      const nextItems = result.data || [];
      const nextTotal = Number(result.total || 0);
      setItems(nextItems);
      setTotal(nextTotal);
      setCacheInfo({ source: 'server', cachedAt: new Date().toISOString() });

      await savePageCache({
        namespace: cacheNamespace,
        tenantId,
        page: nextPage,
        pageSize,
        filters: nextFilters,
        items: nextItems,
        total: nextTotal,
      });

      setLoading(false);
    },
    [cacheNamespace, fetchPage, filters, offlineMode, page, pageSize, tenantId],
  );

  const changePage = useCallback(
    async (nextPage) => {
      if (nextPage < 1 || nextPage > totalPages) return;
      setPage(nextPage);
      await loadPage(nextPage, filters);
    },
    [filters, loadPage, totalPages],
  );

  const updateFilters = useCallback(
    async (nextFilters) => {
      const merged = { ...filters, ...nextFilters };
      setFilters(merged);
      setPage(1);
      await loadPage(1, merged);
    },
    [filters, loadPage],
  );

  const reload = useCallback(async () => {
    await loadPage(page, filters);
  }, [filters, loadPage, page]);

  useEffect(() => {
    loadPage(1, filters);
    setPage(1);
  }, [tenantId, pageSize, offlineMode]);

  return {
    items,
    total,
    page,
    totalPages,
    filters,
    loading,
    error,
    cacheInfo,
    setError,
    changePage,
    updateFilters,
    reload,
    setFilters,
    loadPage,
  };
}
