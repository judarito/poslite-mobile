import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import {
  AI_INSIGHT_CATALOG,
  resolveAiInsightByTextWithFallback,
  runAiInsight,
  runAllAiInsights,
} from '../services/aiInsights.service';
import { generateInsightNarrative } from '../services/aiInsightNarrative.service';

function getToneStyle(tone) {
  if (tone === 'danger') return { borderColor: '#7f1d1d', textColor: '#fecaca', bgColor: '#3f1111' };
  if (tone === 'warn') return { borderColor: '#78350f', textColor: '#fde68a', bgColor: '#3a1f0c' };
  if (tone === 'ok') return { borderColor: '#14532d', textColor: '#bbf7d0', bgColor: '#0f2b19' };
  return { borderColor: '#334155', textColor: '#cbd5e1', bgColor: '#0b1220' };
}

function normalizeResult(result) {
  return {
    insightId: result?.insightId || null,
    title: result?.title || 'Analisis IA',
    summary: result?.summary || 'Sin resumen disponible.',
    highlights: Array.isArray(result?.highlights) ? result.highlights : [],
    findings: Array.isArray(result?.findings) ? result.findings : [],
    recommendations: Array.isArray(result?.recommendations) ? result.recommendations : [],
    engine: result?.engine || null,
    generatedAt: result?.generatedAt || null,
  };
}

export default function AIInsightsScreen({ tenant, offlineMode }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [queryText, setQueryText] = useState('');
  const [loadingId, setLoadingId] = useState('');
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState('');
  const [queryRouting, setQueryRouting] = useState(null);
  const [resultById, setResultById] = useState({});
  const [narrativeById, setNarrativeById] = useState({});
  const [loadingNarrativeId, setLoadingNarrativeId] = useState('');

  const orderedCatalog = useMemo(() => AI_INSIGHT_CATALOG, []);

  const runSingle = async (insightId) => {
    if (!tenant?.tenant_id) return;
    setLoadingId(insightId);
    setError('');
    try {
      const result = await runAiInsight({
        tenantId: tenant.tenant_id,
        insightId,
        offlineMode,
      });
      if (!result.success || !result?.data) {
        setError(result.error || 'No se pudo ejecutar el analisis IA.');
        return;
      }
      setResultById((prev) => ({
        ...prev,
        [insightId]: normalizeResult({ ...result.data, insightId }),
      }));
    } finally {
      setLoadingId('');
    }
  };

  const runAll = async () => {
    if (!tenant?.tenant_id) return;
    setLoadingAll(true);
    setError('');
    try {
      const result = await runAllAiInsights({
        tenantId: tenant.tenant_id,
        offlineMode,
      });
      if (!result.success || !Array.isArray(result?.data)) {
        setError(result.error || 'No fue posible ejecutar todos los analisis IA.');
        return;
      }
      const next = {};
      result.data.forEach((entry) => {
        if (!entry?.success || !entry?.data || !entry?.insightId) return;
        next[entry.insightId] = normalizeResult({ ...entry.data, insightId: entry.insightId });
      });
      if (Object.keys(next).length === 0) {
        setError('No se pudo ejecutar ningun analisis IA. Verifica conexion o cache local.');
        return;
      }
      setResultById((prev) => ({ ...prev, ...next }));
    } finally {
      setLoadingAll(false);
    }
  };

  const runNarrative = async (insightId) => {
    if (!tenant?.tenant_id || !insightId) return;

    let base = resultById[insightId] || null;
    if (!base) {
      const baseRun = await runAiInsight({
        tenantId: tenant.tenant_id,
        insightId,
        offlineMode,
      });
      if (baseRun.success && baseRun?.data) {
        base = normalizeResult({ ...baseRun.data, insightId });
        setResultById((prev) => ({
          ...prev,
          [insightId]: base,
        }));
      }
    }
    if (!base) {
      setError('Primero ejecuta el analisis base para generar narrativa IA.');
      return;
    }

    setLoadingNarrativeId(insightId);
    setError('');
    try {
      const response = await generateInsightNarrative({
        tenantId: tenant.tenant_id,
        insight: {
          insightId,
          title: base.title,
          summary: base.summary,
          highlights: base.highlights,
          findings: base.findings,
          recommendations: base.recommendations,
        },
        offlineMode,
      });
      if (!response.success || !response?.data) {
        setError(response.error || 'No se pudo generar narrativa IA.');
        return;
      }

      setNarrativeById((prev) => ({
        ...prev,
        [insightId]: response.data,
      }));
    } finally {
      setLoadingNarrativeId('');
    }
  };

  const runByQuery = async () => {
    if (!tenant?.tenant_id) return;
    setError('');
    const routed = await resolveAiInsightByTextWithFallback({
      tenantId: tenant.tenant_id,
      queryText,
      offlineMode,
    });

    if (!routed.success || !routed?.data?.insightId) {
      setQueryRouting(null);
      setError(routed.error || 'No pude inferir el tipo de analisis. Prueba con: inventario, compras, ventas, caja, cartera.');
      return;
    }

    setQueryRouting(routed.data);
    await runSingle(routed.data.insightId);
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.heroCard, isLightTheme && styles.heroCardLight]}>
        <Text style={[styles.heroTitle, isLightTheme && styles.heroTitleLight]}>Centro IA</Text>
        <Text style={[styles.heroSub, isLightTheme && styles.heroSubLight]}>
          Analitica aplicada en 8 frentes: inventario, compras, ventas, cajas, cartera, produccion, terceros y ejecutivo.
        </Text>
        <View style={styles.heroActions}>
          <Pressable
            style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight, loadingAll && styles.btnDisabled]}
            onPress={runAll}
            disabled={loadingAll}
          >
            <Ionicons name="flash-outline" size={16} style={styles.primaryBtnIcon} />
            <Text style={styles.primaryBtnText}>{loadingAll ? 'Ejecutando...' : 'Ejecutar los 8 analisis'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.queryCard, isLightTheme && styles.queryCardLight]}>
        <Text style={[styles.queryTitle, isLightTheme && styles.queryTitleLight]}>Consulta natural</Text>
        <TextInput
          style={[styles.input, isLightTheme && styles.inputLight]}
          value={queryText}
          onChangeText={setQueryText}
          placeholder="Ej: quiebres de stock, resumen ejecutivo, clientes inactivos"
          placeholderTextColor="#64748b"
          returnKeyType="search"
          onSubmitEditing={runByQuery}
        />
        <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={runByQuery}>
          <Ionicons name="sparkles-outline" size={15} style={styles.secondaryBtnIcon} />
          <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Analizar consulta</Text>
        </Pressable>
        {queryRouting?.insightId ? (
          <Text style={[styles.queryHint, isLightTheme && styles.queryHintLight]}>
            Ruta sugerida: {orderedCatalog.find((x) => x.id === queryRouting.insightId)?.title || queryRouting.insightId} (
            {Math.round(Number(queryRouting.confidence || 0) * 100)}%)
            {queryRouting?.engine?.source ? ` | ${queryRouting.engine.source}` : ''}
          </Text>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {orderedCatalog.map((item) => {
        const result = resultById[item.id] || null;
        const running = loadingId === item.id;
        const runningNarrative = loadingNarrativeId === item.id;
        const narrative = narrativeById[item.id] || null;
        return (
          <View
            key={item.id}
            style={[
              styles.card,
              isLightTheme && styles.cardLight,
              { borderColor: `${item.accent}66` },
            ]}
          >
            <View style={styles.cardTop}>
              <View style={styles.cardTopLeft}>
                <View style={[styles.iconWrap, { backgroundColor: `${item.accent}20`, borderColor: `${item.accent}66` }]}>
                  <Ionicons name={item.icon} size={18} color={item.accent} />
                </View>
                <View style={styles.cardTextWrap}>
                  <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>{item.title}</Text>
                  <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>{item.subtitle}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => runSingle(item.id)}
                disabled={running}
                style={[styles.runBtn, isLightTheme && styles.runBtnLight, running && styles.btnDisabled]}
              >
                {running ? <ActivityIndicator size="small" color="#eff6ff" /> : <Text style={styles.runBtnText}>Ejecutar</Text>}
              </Pressable>
            </View>

            {result ? (
              <View style={[styles.resultWrap, isLightTheme && styles.resultWrapLight]}>
                <Text style={[styles.resultSummary, isLightTheme && styles.resultSummaryLight]}>{result.summary}</Text>

                <View style={styles.narrativeActionsRow}>
                  <Pressable
                    style={[
                      styles.narrativeBtn,
                      isLightTheme && styles.narrativeBtnLight,
                      runningNarrative && styles.btnDisabled,
                    ]}
                    onPress={() => runNarrative(item.id)}
                    disabled={runningNarrative}
                  >
                    {runningNarrative ? (
                      <ActivityIndicator size="small" color="#eff6ff" />
                    ) : (
                      <>
                        <Ionicons name="chatbubble-ellipses-outline" size={14} style={styles.narrativeBtnIcon} />
                        <Text style={styles.narrativeBtnText}>Explicar con IA</Text>
                      </>
                    )}
                  </Pressable>
                </View>

                <View style={styles.metricsRow}>
                  {result.highlights.map((metric, idx) => {
                    const tone = getToneStyle(metric?.tone);
                    return (
                      <View
                        key={`${item.id}-metric-${idx}`}
                        style={[
                          styles.metricChip,
                          {
                            borderColor: tone.borderColor,
                            backgroundColor: tone.bgColor,
                          },
                        ]}
                      >
                        <Text style={styles.metricLabel}>{metric?.label}</Text>
                        <Text style={[styles.metricValue, { color: tone.textColor }]}>{String(metric?.value ?? '-')}</Text>
                      </View>
                    );
                  })}
                </View>

                {result.findings.length > 0 ? (
                  <View style={styles.block}>
                    <Text style={[styles.blockTitle, isLightTheme && styles.blockTitleLight]}>Hallazgos</Text>
                    {result.findings.map((finding, idx) => (
                      <View key={`${item.id}-finding-${idx}`} style={styles.lineItem}>
                        <Text style={[styles.lineLabel, isLightTheme && styles.lineLabelLight]}>{finding?.label || '-'}</Text>
                        <Text style={[styles.lineValue, isLightTheme && styles.lineValueLight]}>{finding?.value || '-'}</Text>
                        {finding?.meta ? <Text style={[styles.lineMeta, isLightTheme && styles.lineMetaLight]}>{finding.meta}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}

                {result.recommendations.length > 0 ? (
                  <View style={styles.block}>
                    <Text style={[styles.blockTitle, isLightTheme && styles.blockTitleLight]}>Recomendaciones</Text>
                    {result.recommendations.map((line, idx) => (
                    <Text key={`${item.id}-rec-${idx}`} style={[styles.recLine, isLightTheme && styles.recLineLight]}>
                        - {line}
                    </Text>
                  ))}
                </View>
                ) : null}

                {narrative ? (
                  <View style={[styles.narrativeCard, isLightTheme && styles.narrativeCardLight]}>
                    <Text style={[styles.narrativeTitle, isLightTheme && styles.narrativeTitleLight]}>Narrativa IA</Text>
                    {narrative?.narrative_summary ? (
                      <Text style={[styles.narrativeSummary, isLightTheme && styles.narrativeSummaryLight]}>
                        {narrative.narrative_summary}
                      </Text>
                    ) : null}
                    {Array.isArray(narrative?.actions) && narrative.actions.length > 0 ? (
                      <View style={styles.narrativeBlock}>
                        <Text style={[styles.narrativeBlockTitle, isLightTheme && styles.narrativeBlockTitleLight]}>
                          Acciones sugeridas
                        </Text>
                        {narrative.actions.map((line, idx) => (
                          <Text key={`${item.id}-narr-act-${idx}`} style={[styles.narrativeLine, isLightTheme && styles.narrativeLineLight]}>
                            - {line}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {Array.isArray(narrative?.risks) && narrative.risks.length > 0 ? (
                      <View style={styles.narrativeBlock}>
                        <Text style={[styles.narrativeBlockTitle, isLightTheme && styles.narrativeBlockTitleLight]}>
                          Riesgos
                        </Text>
                        {narrative.risks.map((line, idx) => (
                          <Text key={`${item.id}-narr-risk-${idx}`} style={[styles.narrativeLine, isLightTheme && styles.narrativeLineLight]}>
                            - {line}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    <Text style={[styles.narrativeMeta, isLightTheme && styles.narrativeMetaLight]}>
                      Fuente narrativa: {narrative?.engine?.source || 'desconocida'}
                      {narrative?.confidence != null ? ` | Confianza ${Math.round(Number(narrative.confidence || 0) * 100)}%` : ''}
                    </Text>
                  </View>
                ) : null}

                <Text style={[styles.engineLine, isLightTheme && styles.engineLineLight]}>
                  Fuente: {result?.engine?.source || 'desconocida'}
                  {result?.engine?.cachedAt ? ` | Cache: ${new Date(result.engine.cachedAt).toLocaleString()}` : ''}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#060b16',
  },
  containerLight: {
    backgroundColor: '#edf2fb',
  },
  heroCard: {
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  heroCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  heroTitle: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '800',
  },
  heroTitleLight: {
    color: '#0f172a',
  },
  heroSub: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 13,
  },
  heroSubLight: {
    color: '#475569',
  },
  heroActions: {
    marginTop: 10,
  },
  primaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#235ea9',
    backgroundColor: '#235ea9',
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  primaryBtnLight: {
    borderColor: '#1d4f8c',
    backgroundColor: '#1d4f8c',
  },
  primaryBtnIcon: {
    color: '#eff6ff',
  },
  primaryBtnText: {
    color: '#eff6ff',
    fontWeight: '700',
    fontSize: 13,
  },
  queryCard: {
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
  },
  queryCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  queryTitle: {
    color: '#cbd5e1',
    fontWeight: '800',
    marginBottom: 6,
    fontSize: 13,
  },
  queryTitleLight: {
    color: '#0f172a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 9,
    minHeight: 42,
    backgroundColor: '#0b1220',
    color: '#f8fafc',
    paddingHorizontal: 10,
  },
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  secondaryBtn: {
    marginTop: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#13213a',
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryBtnLight: {
    borderColor: '#cfddf0',
    backgroundColor: '#f7fbff',
  },
  secondaryBtnIcon: {
    color: '#93c5fd',
  },
  secondaryBtnText: {
    color: '#dbeafe',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryBtnTextLight: {
    color: '#235ea9',
  },
  queryHint: {
    marginTop: 7,
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '600',
  },
  queryHintLight: {
    color: '#235ea9',
  },
  errorText: {
    color: '#ef4444',
    marginBottom: 8,
    fontWeight: '700',
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    backgroundColor: '#0f172a',
    padding: 10,
    marginBottom: 10,
  },
  cardLight: {
    backgroundColor: '#ffffff',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTextWrap: {
    flex: 1,
  },
  cardTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '800',
  },
  cardTitleLight: {
    color: '#0f172a',
  },
  cardSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 1,
  },
  cardSubtitleLight: {
    color: '#64748b',
  },
  runBtn: {
    borderWidth: 1,
    borderColor: '#235ea9',
    backgroundColor: '#235ea9',
    borderRadius: 8,
    minWidth: 84,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  runBtnLight: {
    borderColor: '#1d4f8c',
    backgroundColor: '#1d4f8c',
  },
  runBtnText: {
    color: '#eff6ff',
    fontWeight: '700',
    fontSize: 12,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  resultWrap: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0b1220',
    padding: 9,
  },
  resultWrapLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fbff',
  },
  resultSummary: {
    color: '#dbeafe',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  resultSummaryLight: {
    color: '#1e3a8a',
  },
  narrativeActionsRow: {
    marginBottom: 8,
  },
  narrativeBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#13213a',
    borderRadius: 8,
    minHeight: 34,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'flex-start',
  },
  narrativeBtnLight: {
    borderColor: '#cfddf0',
    backgroundColor: '#f1f6ff',
  },
  narrativeBtnIcon: {
    color: '#93c5fd',
  },
  narrativeBtnText: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700',
  },
  narrativeCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#3b2f5b',
    borderRadius: 10,
    backgroundColor: '#17132a',
    padding: 9,
  },
  narrativeCardLight: {
    borderColor: '#d7d2ef',
    backgroundColor: '#f7f4ff',
  },
  narrativeTitle: {
    color: '#d7d2ff',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  narrativeTitleLight: {
    color: '#4c3da8',
  },
  narrativeSummary: {
    color: '#ebe8ff',
    fontSize: 12,
    marginBottom: 6,
  },
  narrativeSummaryLight: {
    color: '#2b2357',
  },
  narrativeBlock: {
    marginTop: 6,
  },
  narrativeBlockTitle: {
    color: '#c4baff',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 3,
  },
  narrativeBlockTitleLight: {
    color: '#5b4fb8',
  },
  narrativeLine: {
    color: '#ddd6fe',
    fontSize: 12,
    marginBottom: 3,
  },
  narrativeLineLight: {
    color: '#334155',
  },
  narrativeMeta: {
    marginTop: 6,
    color: '#a5b4fc',
    fontSize: 11,
    fontWeight: '600',
  },
  narrativeMetaLight: {
    color: '#475569',
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metricChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 106,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 2,
  },
  metricValue: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
  },
  block: {
    marginTop: 10,
  },
  blockTitle: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  blockTitleLight: {
    color: '#334155',
  },
  lineItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingVertical: 6,
  },
  lineLabel: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  lineLabelLight: {
    color: '#0f172a',
  },
  lineValue: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 1,
  },
  lineValueLight: {
    color: '#334155',
  },
  lineMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 1,
  },
  lineMetaLight: {
    color: '#64748b',
  },
  recLine: {
    color: '#cbd5e1',
    fontSize: 12,
    marginBottom: 4,
  },
  recLineLight: {
    color: '#334155',
  },
  engineLine: {
    marginTop: 8,
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  engineLineLight: {
    color: '#475569',
  },
});
