import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import {
  getAllCreditAccounts,
  getCreditMovements,
  getPortfolioSummary,
  registerCreditPayment,
} from '../services/credit.service';

export default function CarteraScreen({ tenant, userProfile, formatMoney, offlineMode }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [loading, setLoading] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [movements, setMovements] = useState([]);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    if (!tenant?.tenant_id) return;

    setLoading(true);
    setError('');

    const [summaryResult, accountsResult] = await Promise.all([
      getPortfolioSummary(tenant.tenant_id),
      getAllCreditAccounts(tenant.tenant_id),
    ]);

    if (!summaryResult.success) {
      setError(summaryResult.error || 'No fue posible cargar resumen de cartera');
      setSummary(null);
    } else {
      setSummary(summaryResult.data);
    }

    if (!accountsResult.success) {
      setError(accountsResult.error || 'No fue posible cargar cuentas de cartera');
      setAccounts([]);
    } else {
      setAccounts(accountsResult.data || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [tenant?.tenant_id]);

  const openMovements = async (account) => {
    setSelectedAccount(account);
    setLoadingMovements(true);
    const result = await getCreditMovements(tenant?.tenant_id, account.credit_account_id);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar movimientos');
      setMovements([]);
    } else {
      setMovements(result.data || []);
    }
    setLoadingMovements(false);
  };

  const registerPayment = async () => {
    if (offlineMode) {
      setError('No puedes registrar abonos en modo offline.');
      return;
    }

    const amount = Number(payAmount || 0);
    if (!selectedAccount?.credit_account_id || !amount || amount <= 0 || !userProfile?.user_id) {
      setError('Debes ingresar un monto valido y tener usuario activo.');
      return;
    }

    setSaving(true);
    const result = await registerCreditPayment(
      tenant.tenant_id,
      selectedAccount.credit_account_id,
      amount,
      payNote || null,
      userProfile.user_id,
    );

    if (!result.success) {
      setError(result.error || 'No fue posible registrar abono');
      setSaving(false);
      return;
    }

    setPayAmount('');
    setPayNote('');
    await openMovements(selectedAccount);
    await loadData();
    setSaving(false);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>Cartera</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator color="#22d3ee" style={{ marginTop: 24 }} />
      ) : (
        <ScrollView style={styles.list}>
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Deuda total</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>{formatMoney(summary?.total_debt || 0)}</Text>
            </View>
            <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Cuentas activas</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>{summary?.total_accounts || 0}</Text>
            </View>
          </View>

          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Con deuda</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>{summary?.accounts_with_debt || 0}</Text>
            </View>
            <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Sobre cupo</Text>
              <Text style={[styles.summaryValue, isLightTheme && styles.summaryValueLight]}>{summary?.accounts_overdue || 0}</Text>
            </View>
          </View>

          {accounts.map((account) => (
            <Pressable key={account.credit_account_id} style={[styles.card, isLightTheme && styles.cardLight]} onPress={() => openMovements(account)}>
              <Text style={[styles.name, isLightTheme && styles.nameLight]}>{account.customer?.full_name || 'Cliente'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Documento: {account.customer?.document || '-'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Saldo: {formatMoney(account.current_balance || 0)}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Cupo: {formatMoney(account.credit_limit || 0)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={Boolean(selectedAccount)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedAccount(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Movimientos de cartera</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {selectedAccount?.customer?.full_name || '-'} · Saldo {formatMoney(selectedAccount?.current_balance || 0)}
            </Text>

            {loadingMovements ? (
              <ActivityIndicator color="#22d3ee" style={{ marginVertical: 14 }} />
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {movements.length === 0 ? <Text style={[styles.empty, isLightTheme && styles.emptyLight]}>Sin movimientos</Text> : null}
                {movements.map((move) => (
                  <View key={move.movement_id} style={styles.moveRow}>
                    <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{move.source}</Text>
                    <Text style={[styles.meta, { color: Number(move.amount) < 0 ? '#16a34a' : '#dc2626' }]}>
                      {formatMoney(move.amount || 0)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={[styles.actionBox, isLightTheme && styles.actionBoxLight]}>
              <Text style={[styles.summaryLabel, isLightTheme && styles.summaryLabelLight]}>Registrar abono</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={payAmount}
                onChangeText={setPayAmount}
                placeholder="Monto"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={payNote}
                onChangeText={setPayNote}
                placeholder="Nota (opcional)"
                placeholderTextColor="#64748b"
              />
              <Pressable style={styles.primaryBtn} onPress={registerPayment} disabled={saving}>
                <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar abono'}</Text>
              </Pressable>
            </View>

            <Pressable onPress={() => setSelectedAccount(null)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  titleLight: { color: '#0f172a' },
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  summaryCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 10,
  },
  summaryCardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  summaryLabel: { color: '#93c5fd', fontSize: 12, marginBottom: 3 },
  summaryLabelLight: { color: '#1d4ed8' },
  summaryValue: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  summaryValueLight: { color: '#0f172a' },
  list: { flex: 1 },
  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937', borderRadius: 12, padding: 12, marginBottom: 8 },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  name: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  nameLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
  moveRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  actionBox: { marginTop: 10, borderWidth: 1, borderColor: '#1f2937', borderRadius: 10, padding: 10 },
  actionBoxLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    color: '#f8fafc',
    marginTop: 8,
    backgroundColor: '#111827',
  },
  inputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  primaryBtn: { marginTop: 10, backgroundColor: '#0ea5e9', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  primaryBtnText: { color: '#ecfeff', fontWeight: '700' },
  empty: { color: '#94a3b8', marginTop: 12, textAlign: 'center' },
  emptyLight: { color: '#64748b' },
  error: { color: '#f87171', marginBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: { maxHeight: '88%', backgroundColor: '#0f172a', borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 14 },
  modalBodyLight: { backgroundColor: '#f8fafc' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  modalTitleLight: { color: '#0f172a' },
  closeBtn: { marginTop: 12, alignSelf: 'flex-end', backgroundColor: '#1d4ed8', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
