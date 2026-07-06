import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Dimensions, ActivityIndicator, Alert, Image, TextInput,
  Modal, Keyboard, KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { useUserStore } from '../../store/userStore';
import { BADGES, loadUserStats, saveUserStats, type UserStats, type BadgeId, xpProgress } from '../../lib/streaks';
import { loadWeeklyMissions, claimMission, type MissionProgress } from '../../lib/missions';
import { uploadTransformPhoto, signPhotoUrls } from '../../lib/transformPhotos';
import { projectGoal } from '../../lib/goalMath';
import { track } from '../../lib/analytics';
import { Colors, Fonts, Radii, Spacing } from '../../constants/theme';

const { width } = Dimensions.get('window');
const CHART_W = width - 48;
const CHART_H = 140;

type WeightEntry = { date: string; weight: number };
type TransformPhoto = { id: string; uri: string; date: string; displayUri: string };

function WeightChart({ entries, gainIsGood }: { entries: WeightEntry[]; gainIsGood: boolean }) {
  if (entries.length < 2) {
    return (
      <View style={{ height: 70, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgInput, borderRadius: Radii.md }}>
        <Text style={{ fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textAlign: 'center' }}>
          Registra al menos 2 pesajes para ver la gráfica
        </Text>
      </View>
    );
  }

  const weights = entries.map((e) => e.weight);
  const minW = Math.min(...weights) - 0.5;
  const maxW = Math.max(...weights) + 0.5;
  const pl = 36, pr = 12, pt = 14, pb = 28;
  const iW = CHART_W - pl - pr;
  const iH = CHART_H - pt - pb;
  const tx = (i: number) => pl + (i / (entries.length - 1)) * iW;
  const ty = (w: number) => pt + ((maxW - w) / (maxW - minW)) * iH;
  const pts = entries.map((e, i) => `${tx(i)},${ty(e.weight)}`).join(' ');
  const trend = weights[weights.length - 1] - weights[0];

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase' }}>
          {entries.length} registros
        </Text>
        <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 12, color: (gainIsGood ? trend >= 0 : trend <= 0) ? Colors.accent : '#ff7c3a' }}>
          {trend >= 0 ? '+' : ''}{trend.toFixed(1)} kg total
        </Text>
      </View>
      <Svg width={CHART_W} height={CHART_H}>
        {[0, 0.5, 1].map((t) => (
          <Line key={t} x1={pl} y1={pt + t * iH} x2={CHART_W - pr} y2={pt + t * iH}
            stroke={Colors.border} strokeWidth={0.5} />
        ))}
        {[maxW, (maxW + minW) / 2, minW].map((w, i) => (
          <SvgText key={i} x={pl - 4} y={pt + (i * iH / 2) + 4}
            fill={Colors.textMuted} fontSize={8} textAnchor="end" fontFamily={Fonts.body}>
            {w.toFixed(0)}
          </SvgText>
        ))}
        <Polyline points={pts} fill="none" stroke={Colors.accent} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" />
        {entries.map((e, i) => (
          <Circle key={i} cx={tx(i)} cy={ty(e.weight)} r={4}
            fill={Colors.accent} stroke={Colors.bg} strokeWidth={2} />
        ))}
        {[0, entries.length - 1].map((i) => (
          <SvgText key={i} x={tx(i)} y={CHART_H - 4}
            fill={Colors.textMuted} fontSize={8} textAnchor="middle" fontFamily={Fonts.body}>
            {entries[i].date.slice(5)}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

function BadgeCard({ badge, earned }: { badge: typeof BADGES[number]; earned: boolean }) {
  return (
    <View style={[s.badgeCard, !earned && s.badgeLocked]}>
      <Text style={[s.badgeEmoji, !earned && { opacity: 0.3 }]}>{badge.emoji}</Text>
      <Text style={[s.badgeTitle, !earned && { color: Colors.textMuted }]}>{badge.title}</Text>
      <Text style={[s.badgeDesc, !earned && { opacity: 0.5 }]}>{badge.desc}</Text>
      <View style={[s.xpPill, !earned && { backgroundColor: Colors.bgInput }]}>
        <Text style={[s.xpPillTxt, !earned && { color: Colors.textMuted }]}>+{badge.xp} XP</Text>
      </View>
    </View>
  );
}

export default function ProgressScreen() {
  const profile = useUserStore((s: any) => s.profile);
  const setProfile = useUserStore((s: any) => s.setProfile);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [photos, setPhotos] = useState<TransformPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [weightModal, setWeightModal] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [missions, setMissions] = useState<MissionProgress[]>([]);
  const [goalModal, setGoalModal] = useState(false);
  const [goalTargetInput, setGoalTargetInput] = useState('');
  const [goalWhyInput, setGoalWhyInput] = useState('');

  useEffect(() => { if (profile) loadAll(); }, [profile]);

  // Refrescar (sin spinner) cada vez que la pestaña gana foco: así el XP,
  // la racha y las misiones se ven al día justo después de entrenar.
  useFocusEffect(
    useCallback(() => {
      if (profile) loadAll(true);
    }, [profile?.user_id])
  );

  async function loadAll(quiet = false) {
    if (!profile) return;
    if (!quiet) setLoading(true);
    try {
      const [st, ws, ps, ms] = await Promise.all([
        loadUserStats(profile.user_id),
        // Los 14 registros MÁS RECIENTES (desc + reverse). Con .order asc +
        // limit devolvía los 14 más viejos y la gráfica se congelaba.
        supabase
          .from('weight_entries')
          .select('date,weight')
          .eq('user_id', profile.user_id)
          .order('date', { ascending: false })
          .limit(14),
        supabase
          .from('transform_photos')
          .select('id,uri,date')
          .eq('user_id', profile.user_id)
          .order('date', { ascending: false })
          .limit(12),
        loadWeeklyMissions(profile.user_id),
      ]);
      setStats(st);
      setWeights(((ws.data ?? []) as WeightEntry[]).slice().reverse()); // asc para la gráfica
      setMissions(ms);

      // Firmar los paths de Storage para poder mostrar las fotos (bucket privado).
      const rows = (ps.data ?? []) as { id: string; uri: string; date: string }[];
      const signed = await signPhotoUrls(rows.map((r) => r.uri));
      setPhotos(rows.map((r) => ({ ...r, displayUri: signed[r.uri] ?? r.uri })));
    } finally {
      setLoading(false);
    }
  }

  // Economía de racha: comprar un comodín gastando XP (máx. 2 en reserva).
  const FREEZE_COST = 300;
  async function buyFreeze() {
    if (!profile || !stats) return;
    if (stats.total_xp < FREEZE_COST) {
      Alert.alert('Te falta XP', `Necesitas ${FREEZE_COST} XP (tienes ${stats.total_xp}). Entrena y registra comidas para ganar más.`);
      return;
    }
    Alert.alert(
      '🧊 Conseguir comodín',
      `¿Cambiar ${FREEZE_COST} XP por 1 comodín de racha? Te salva si fallas un día.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, cambiar',
          onPress: async () => {
            await saveUserStats(profile.user_id, {
              total_xp: stats.total_xp - FREEZE_COST,
              streak_freezes: stats.streak_freezes + 1,
            });
            track('streak_freeze_bought', { xp_spent: FREEZE_COST });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await loadAll(true);
          },
        },
      ]
    );
  }

  async function onClaimMission(m: MissionProgress) {
    if (!profile || !m.done || m.claimed) return;
    const xp = await claimMission(profile.user_id, m.id);
    if (xp > 0) {
      track('mission_claimed', { mission_id: m.id, xp });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadAll(true); // refresco silencioso: sin flash de spinner
    }
  }

  async function saveWeight() {
    const w = parseFloat(newWeight.replace(',', '.'));
    if (!profile || isNaN(w) || w < 30 || w > 300) {
      Alert.alert('Peso inválido', 'Ingresa un número entre 30 y 300.');
      return;
    }
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('weight_entries')
      .upsert({ user_id: profile.user_id, date: today, weight: w }, { onConflict: 'user_id,date' });
    if (error) { Alert.alert('Error', error.message); return; }
    setWeights((prev: WeightEntry[]) => {
      const f = prev.filter((e: WeightEntry) => e.date !== today);
      return [...f, { date: today, weight: w }].sort((a: WeightEntry, b: WeightEntry) =>
        a.date.localeCompare(b.date)
      );
    });
    track('weight_logged');
    setNewWeight('');
    setWeightModal(false);
  }

  // ── Meta concreta de peso (target + porqué) ────────────
  function openGoalModal() {
    setGoalTargetInput(
      profile?.target_weight_kg != null ? String(profile.target_weight_kg) : ''
    );
    setGoalWhyInput(profile?.goal_why ?? '');
    setGoalModal(true);
  }

  async function saveGoal(remove = false) {
    if (!profile) return;
    let tw: number | null = null;
    if (!remove) {
      tw = parseFloat(goalTargetInput.replace(',', '.'));
      if (isNaN(tw) || tw < 30 || tw > 300) {
        Alert.alert('Meta inválida', 'Ingresa un peso objetivo entre 30 y 300 kg.');
        return;
      }
    }
    Keyboard.dismiss();
    const curWeight = weights.length > 0 ? weights[weights.length - 1].weight : profile.weight_kg;
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        target_weight_kg: tw,
        goal_why: remove ? null : goalWhyInput.trim() || null,
        // Snapshot del punto de partida SOLO al fijar/cambiar la meta.
        goal_start_weight_kg: tw != null ? curWeight : null,
      })
      .eq('user_id', profile.user_id)
      .select()
      .single();
    if (error) { Alert.alert('Error', error.message); return; }
    setProfile(data as any);
    track('goal_set', { removed: remove, has_why: !remove && !!goalWhyInput.trim() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setGoalModal(false);
  }

  async function takeTransformPhoto() {
    if (!profile) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled) return;
    const localUri = result.assets[0].uri;
    const today = new Date().toISOString().split('T')[0];
    const id = Date.now().toString();

    // Subir al Storage privado. Si falla (offline), caemos al URI local para
    // no bloquear al usuario, aunque esa foto no sincronizará entre dispositivos.
    const up = await uploadTransformPhoto(profile.user_id, localUri);
    const storedUri = 'path' in up ? up.path : localUri;
    if ('error' in up && __DEV__) console.log('[Transform] subida falló:', up.error);

    const { error: insertError } = await supabase
      .from('transform_photos')
      .insert({ id, user_id: profile.user_id, uri: storedUri, date: today });

    if (insertError) {
      Alert.alert('No se pudo guardar', insertError.message);
      return;
    }

    // Para mostrarla ya: si subió a Storage, firmar; si fue local, usarla tal cual.
    const signed = 'path' in up ? await signPhotoUrls([storedUri]) : { [storedUri]: localUri };
    setPhotos((prev: TransformPhoto[]) => [
      { id, uri: storedUri, date: today, displayUri: signed[storedUri] ?? localUri },
      ...prev,
    ]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </View>
    );
  }

  const xpInfo = xpProgress(stats?.total_xp ?? 0);
  const earnedIds = (stats?.earned_badges ?? []) as BadgeId[];
  const earnedBadges = BADGES.filter((b: any) => earnedIds.includes(b.id));
  const nextBadges = BADGES.filter((b: any) => !earnedIds.includes(b.id)).slice(0, 6);
  const curW = weights.length > 0 ? weights[weights.length - 1].weight : profile?.weight_kg ?? 0;
  const wChange = weights.length >= 2 ? curW - weights[0].weight : 0;

  // Proyección hacia la meta concreta (si el usuario la definió).
  const projection = profile?.target_weight_kg != null
    ? projectGoal({
        goal: profile.goal,
        currentWeight: curW,
        targetWeight: Number(profile.target_weight_kg),
        startWeight: profile.goal_start_weight_kg != null
          ? Number(profile.goal_start_weight_kg)
          : (weights[0]?.weight ?? curW),
        points: weights,
      })
    : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>PROGRESO</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={s.ghostBtn} onPress={() => router.push('/history' as any)}>
              <Text style={s.ghostBtnTxt}>🏆 Historial</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.accentBtn} onPress={() => {
              setNewWeight('');
              setWeightModal(true);
            }}>
              <Text style={s.accentBtnTxt}>+ Peso</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Racha + XP */}
        <View style={s.streakCard}>
          <View style={s.streakLeft}>
            <Text style={{ fontSize: 40 }}>🔥</Text>
            <View>
              <Text style={s.streakNum}>{stats?.current_streak ?? 0}</Text>
              <Text style={s.streakLabel}>días en racha</Text>
              {(stats?.longest_streak ?? 0) > 0 && (
                <Text style={s.streakMax}>Mejor: {stats!.longest_streak} días</Text>
              )}
            </View>
          </View>
          <View style={s.streakDivider} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
              <Text style={s.levelTxt}>Nivel {xpInfo.level}</Text>
              <Text style={s.xpTxt}>{stats?.total_xp ?? 0} XP</Text>
            </View>
            <View style={s.xpBg}>
              <View style={[s.xpFill, { width: `${xpInfo.progress * 100}%` }]} />
            </View>
            <Text style={s.xpNext}>→ Nv.{xpInfo.level + 1} en {xpInfo.xpNeeded} XP</Text>
          </View>
        </View>

        {/* Stats grid */}
        <View style={s.grid4}>
          {[
            { icon: '🏋️', val: stats?.total_workouts ?? 0, lbl: 'Entrenos' },
            { icon: '📸', val: stats?.total_meals_logged ?? 0, lbl: 'Comidas' },
            { icon: '🎯', val: stats?.total_macro_perfect_days ?? 0, lbl: 'Días macro ✓' },
            { icon: '🏆', val: earnedIds.length, lbl: 'Logros' },
          ].map((st) => (
            <View key={st.lbl} style={s.statCell}>
              <Text style={s.statIcon}>{st.icon}</Text>
              <Text style={s.statVal}>{st.val}</Text>
              <Text style={s.statLbl}>{st.lbl}</Text>
            </View>
          ))}
        </View>

        {/* Comodín de racha (+ comprar con XP) */}
        <View style={s.freezeRow}>
          <Text style={{ fontSize: 18 }}>🧊</Text>
          <Text style={s.freezeTxt}>
            {(stats?.streak_freezes ?? 0) > 0
              ? `Tienes ${stats!.streak_freezes} comodín${stats!.streak_freezes === 1 ? '' : 'es'} de racha — te salva si fallas un día.`
              : 'Sin comodines de racha. Consigue uno para proteger tu racha.'}
          </Text>
          {(stats?.streak_freezes ?? 0) < 2 && (
            <TouchableOpacity style={s.freezeBuyBtn} onPress={buyFreeze} accessibilityLabel="Conseguir comodín de racha">
              <Text style={s.freezeBuyTxt}>+1 por {FREEZE_COST} XP</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Misiones semanales */}
        <View style={s.section}>
          <Text style={s.sectionLbl}>MISIONES DE LA SEMANA</Text>
        </View>
        {missions.map((m) => {
          const pct = Math.min((m.current / m.target) * 100, 100);
          return (
            <View key={m.id} style={s.missionCard}>
              <Text style={{ fontSize: 22 }}>{m.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.missionLbl}>{m.label}</Text>
                <View style={s.missionBarBg}>
                  <View style={[s.missionBarFill, { width: `${pct}%` }]} />
                </View>
                <Text style={s.missionMeta}>{Math.min(m.current, m.target)}/{m.target} · +{m.xp} XP</Text>
              </View>
              {m.claimed ? (
                <Text style={s.missionClaimed}>✓</Text>
              ) : m.done ? (
                <TouchableOpacity style={s.missionClaimBtn} onPress={() => onClaimMission(m)}>
                  <Text style={s.missionClaimTxt}>Reclamar</Text>
                </TouchableOpacity>
              ) : (
                <Text style={s.missionPending}>{Math.round(pct)}%</Text>
              )}
            </View>
          );
        })}

        {/* Meta concreta + proyección */}
        <View style={[s.section, { justifyContent: 'space-between' }]}>
          <Text style={s.sectionLbl}>MI META</Text>
          {projection && (
            <TouchableOpacity onPress={openGoalModal}>
              <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent }}>Editar</Text>
            </TouchableOpacity>
          )}
        </View>
        {projection ? (
          <View style={s.goalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Text style={{ fontSize: 20 }}>
                {projection.pctComplete >= 100 ? '🏆' : projection.onTrack ? '🚀' : projection.reversing ? '⚠️' : '🎯'}
              </Text>
              <Text style={s.goalHeadline}>{projection.headline}</Text>
            </View>
            <Text style={s.goalDetail}>{projection.detail}</Text>
            {profile?.goal_why ? <Text style={s.goalWhy}>💭 "{profile.goal_why}"</Text> : null}
            <View style={s.goalBarBg}>
              <View style={[s.goalBarFill, { width: `${Math.round(projection.pctComplete)}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
              <Text style={s.goalMark}>{projection.startWeight.toFixed(1)} kg</Text>
              <Text style={[s.goalMark, { color: Colors.textPrimary, fontFamily: Fonts.bodySemi }]}>
                {curW.toFixed(1)} kg
              </Text>
              <Text style={[s.goalMark, { color: Colors.accent, fontFamily: Fonts.bodySemi }]}>
                🎯 {projection.targetWeight?.toFixed(1)} kg
              </Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.goalEmptyCard} onPress={openGoalModal} activeOpacity={0.85}>
            <Text style={{ fontSize: 26 }}>🎯</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.goalEmptyTitle}>Ponle un número a tu meta</Text>
              <Text style={s.goalEmptySub}>
                Define tu peso objetivo y te proyecto cuándo llegas al ritmo actual.
              </Text>
            </View>
            <Text style={{ fontFamily: Fonts.heading, fontSize: 22, color: Colors.accent }}>›</Text>
          </TouchableOpacity>
        )}

        {/* Peso */}
        <View style={s.section}>
          <Text style={s.sectionLbl}>EVOLUCIÓN DE PESO</Text>
        </View>
        <View style={s.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <View>
              <Text style={s.miniLbl}>Peso actual</Text>
              <Text style={s.bigNum}>{curW.toFixed(1)}<Text style={s.miniUnit}> kg</Text></Text>
            </View>
            {weights.length >= 2 && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.wChange, { color: (profile?.goal === 'muscle_gain' ? wChange >= 0 : wChange <= 0) ? Colors.accent : '#ff7c3a' }]}>
                  {wChange >= 0 ? '+' : ''}{wChange.toFixed(1)} kg
                </Text>
                <Text style={s.miniLbl}>desde inicio</Text>
              </View>
            )}
          </View>
          <WeightChart entries={weights} gainIsGood={profile?.goal === 'muscle_gain'} />
        </View>

        {/* Fotos transformación */}
        <View style={[s.section, { justifyContent: 'space-between' }]}>
          <Text style={s.sectionLbl}>TRANSFORMACIÓN</Text>
          <TouchableOpacity onPress={takeTransformPhoto}>
            <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accent }}>+ Foto</Text>
          </TouchableOpacity>
        </View>

        {photos.length === 0 ? (
          <TouchableOpacity style={s.emptyPhotos} onPress={takeTransformPhoto} activeOpacity={0.85}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>📷</Text>
            <Text style={s.emptyTitle}>Toma tu foto de hoy</Text>
            <Text style={s.emptySub}>En 30 días verás la diferencia. Empieza ahora.</Text>
          </TouchableOpacity>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 10 }}>
            <TouchableOpacity style={s.addPhotoCell} onPress={takeTransformPhoto} activeOpacity={0.85}>
              <Text style={{ fontSize: 24, color: Colors.accent }}>+</Text>
              <Text style={s.addPhotoLbl}>Nueva{'\n'}foto</Text>
            </TouchableOpacity>
            {photos.map((p: TransformPhoto) => (
              <View key={p.id}>
                <Image source={{ uri: p.displayUri }} style={s.photoImg} />
                <Text style={s.photoDate}>{p.date.slice(5)}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Badges ganados */}
        {earnedBadges.length > 0 && (
          <>
            <View style={s.section}>
              <Text style={s.sectionLbl}>LOGROS · {earnedBadges.length}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 10 }}>
              {earnedBadges.map((b: any) => <BadgeCard key={b.id} badge={b} earned />)}
            </ScrollView>
          </>
        )}

        {/* Próximos badges */}
        <View style={s.section}>
          <Text style={s.sectionLbl}>PRÓXIMOS LOGROS</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, gap: 10, paddingBottom: 8 }}>
          {nextBadges.map((b: any) => <BadgeCard key={b.id} badge={b} earned={false} />)}
        </ScrollView>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modal registrar peso */}
      <Modal
        visible={weightModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          Keyboard.dismiss();
          setWeightModal(false);
        }}
      >
        <TouchableWithoutFeedback onPress={() => {
          Keyboard.dismiss();
          setWeightModal(false);
        }}>
          <View style={s.overlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : 'height'}>
                <View style={s.modalBox}>
                  <Text style={s.modalTitle}>REGISTRAR PESO</Text>
                  <Text style={s.modalSub}>¿Cuánto pesaste hoy en ayunas?</Text>

                  <View style={s.inputRow}>
                    <TextInput
                      style={s.weightInput}
                      value={newWeight}
                      onChangeText={setNewWeight}
                      keyboardType="decimal-pad"
                      placeholder="78.5"
                      placeholderTextColor={Colors.textMuted}
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={saveWeight}
                    />
                    <Text style={s.inputUnit}>kg</Text>
                  </View>

                  <TouchableOpacity style={s.saveBtn} onPress={saveWeight} activeOpacity={0.85}>
                    <Text style={s.saveBtnTxt}>GUARDAR ✓</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => { Keyboard.dismiss(); setWeightModal(false); }}
                    style={{ paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted }}>
                      Cancelar
                    </Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Modal meta de peso */}
      <Modal
        visible={goalModal}
        transparent
        animationType="slide"
        onRequestClose={() => { Keyboard.dismiss(); setGoalModal(false); }}
      >
        <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setGoalModal(false); }}>
          <View style={s.overlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'position' : 'height'}>
                <View style={s.modalBox}>
                  <Text style={s.modalTitle}>🎯 MI META</Text>
                  <Text style={s.modalSub}>¿A qué peso quieres llegar?</Text>

                  <View style={s.inputRow}>
                    <TextInput
                      style={s.weightInput}
                      value={goalTargetInput}
                      onChangeText={setGoalTargetInput}
                      keyboardType="decimal-pad"
                      placeholder={curW ? String(Math.round(curW)) : '74'}
                      placeholderTextColor={Colors.textMuted}
                      autoFocus
                      returnKeyType="done"
                    />
                    <Text style={s.inputUnit}>kg</Text>
                  </View>

                  <TextInput
                    style={s.goalWhyInput}
                    value={goalWhyInput}
                    onChangeText={setGoalWhyInput}
                    placeholder="¿Por qué lo quieres lograr? (opcional)"
                    placeholderTextColor={Colors.textMuted}
                    maxLength={120}
                  />

                  <TouchableOpacity style={s.saveBtn} onPress={() => saveGoal()} activeOpacity={0.85}>
                    <Text style={s.saveBtnTxt}>GUARDAR META ✓</Text>
                  </TouchableOpacity>

                  {profile?.target_weight_kg != null && (
                    <TouchableOpacity
                      onPress={() => saveGoal(true)}
                      style={{ paddingTop: 12, alignItems: 'center' }}
                    >
                      <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.warning }}>
                        Quitar meta
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={() => { Keyboard.dismiss(); setGoalModal(false); }}
                    style={{ paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ fontFamily: Fonts.bodyMedium, fontSize: 14, color: Colors.textMuted }}>
                      Cancelar
                    </Text>
                  </TouchableOpacity>
                </View>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: 12,
  },
  headerTitle: { fontFamily: Fonts.heading, fontSize: 36, color: Colors.textPrimary },
  accentBtn: { backgroundColor: Colors.accent, borderRadius: Radii.full, paddingHorizontal: 14, paddingVertical: 8 },
  accentBtnTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#0a0a0b' },
  ghostBtn: { backgroundColor: Colors.bgCard, borderRadius: Radii.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  ghostBtnTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textPrimary },
  streakCard: {
    marginHorizontal: Spacing.lg, marginBottom: 12, backgroundColor: Colors.bgCard,
    borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, flexDirection: 'row', alignItems: 'center',
  },
  streakLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  streakNum: { fontFamily: Fonts.heading, fontSize: 52, color: Colors.accent, lineHeight: 52 },
  streakLabel: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  streakMax: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 2 },
  streakDivider: { width: 1, height: 56, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
  levelTxt: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.textPrimary },
  xpTxt: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  xpBg: { height: 5, backgroundColor: Colors.border, borderRadius: 10, overflow: 'hidden', marginBottom: 4 },
  xpFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 10 },
  xpNext: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted },
  freezeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.lg, marginBottom: 16, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, padding: 12 },
  freezeTxt: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  freezeBuyBtn: { backgroundColor: Colors.bgSelected, borderWidth: 1, borderColor: Colors.accentBorder, borderRadius: Radii.full, paddingHorizontal: 10, paddingVertical: 6 },
  freezeBuyTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent },
  missionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: Spacing.lg, marginBottom: 8, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.lg, padding: Spacing.md },
  missionLbl: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textPrimary, marginBottom: 6 },
  missionBarBg: { height: 5, backgroundColor: Colors.border, borderRadius: 10, overflow: 'hidden' },
  missionBarFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 10 },
  missionMeta: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textMuted, marginTop: 4 },
  missionClaimBtn: { backgroundColor: Colors.accent, borderRadius: Radii.full, paddingHorizontal: 12, paddingVertical: 7 },
  goalCard: { marginHorizontal: Spacing.lg, marginBottom: 16, backgroundColor: Colors.bgSelected, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.accentBorder, padding: Spacing.md },
  goalHeadline: { flex: 1, fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary },
  goalDetail: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  goalWhy: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accent, fontStyle: 'italic', marginTop: 8 },
  goalBarBg: { height: 6, backgroundColor: Colors.border, borderRadius: 10, overflow: 'hidden', marginTop: 12 },
  goalBarFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 10 },
  goalMark: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted },
  goalEmptyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: Spacing.lg, marginBottom: 16, backgroundColor: Colors.bgCard, borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  goalEmptyTitle: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textPrimary },
  goalEmptySub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 17, marginTop: 2 },
  goalWhyInput: { backgroundColor: Colors.bgInput, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.md, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.body, fontSize: 14, color: Colors.textPrimary, marginBottom: 14 },
  missionClaimTxt: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#0a0a0b' },
  missionClaimed: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.accent },
  missionPending: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted },
  grid4: { flexDirection: 'row', gap: 8, marginHorizontal: Spacing.lg, marginBottom: 20 },
  statCell: {
    flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radii.md,
    borderWidth: 1, borderColor: Colors.border, padding: 10, alignItems: 'center',
  },
  statIcon: { fontSize: 18, marginBottom: 4 },
  statVal: { fontFamily: Fonts.headingBold, fontSize: 22, color: Colors.textPrimary },
  statLbl: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textMuted, textAlign: 'center', marginTop: 2 },
  section: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, marginBottom: 10 },
  sectionLbl: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, flex: 1,
  },
  card: {
    marginHorizontal: Spacing.lg, marginBottom: 20, backgroundColor: Colors.bgCard,
    borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md,
  },
  miniLbl: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginBottom: 2 },
  bigNum: { fontFamily: Fonts.heading, fontSize: 40, color: Colors.textPrimary },
  miniUnit: { fontFamily: Fonts.body, fontSize: 16, color: Colors.textMuted },
  wChange: { fontFamily: Fonts.headingBold, fontSize: 24 },
  emptyPhotos: {
    marginHorizontal: Spacing.lg, marginBottom: 20, backgroundColor: Colors.bgCard,
    borderRadius: Radii.xl, borderWidth: 1, borderColor: Colors.border,
    borderStyle: 'dashed', padding: Spacing.xl, alignItems: 'center',
  },
  emptyTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.textPrimary, marginBottom: 6 },
  emptySub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  addPhotoCell: {
    width: 88, height: 118, backgroundColor: Colors.bgCard, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.accentBorder, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  addPhotoLbl: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent, textAlign: 'center' },
  photoImg: { width: 88, height: 118, borderRadius: Radii.lg, backgroundColor: Colors.bgCard },
  photoDate: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textMuted, textAlign: 'center', marginTop: 4 },
  badgeCard: {
    width: 115, backgroundColor: Colors.bgCard, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border, padding: 12, alignItems: 'center', gap: 4,
  },
  badgeLocked: { opacity: 0.65 },
  badgeEmoji: { fontSize: 32, marginBottom: 4 },
  badgeTitle: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.textPrimary, textAlign: 'center' },
  badgeDesc: { fontFamily: Fonts.body, fontSize: 9, color: Colors.textMuted, textAlign: 'center' },
  xpPill: { backgroundColor: Colors.accentMuted, borderRadius: Radii.full, paddingHorizontal: 8, paddingVertical: 3, marginTop: 2 },
  xpPillTxt: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.accent },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: Colors.bgCard, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: Spacing.xl, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  modalTitle: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.textPrimary, marginBottom: 4 },
  modalSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginBottom: Spacing.lg },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.bgInput, borderRadius: Radii.lg,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: 6, marginBottom: Spacing.lg,
  },
  weightInput: { fontFamily: Fonts.heading, fontSize: 48, color: Colors.textPrimary, flex: 1 },
  inputUnit: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.textMuted },
  saveBtn: {
    backgroundColor: Colors.accent, borderRadius: Radii.lg,
    paddingVertical: 16, alignItems: 'center', marginBottom: 10,
  },
  saveBtnTxt: { fontFamily: Fonts.heading, fontSize: 18, color: '#0a0a0b', letterSpacing: 0.8 },
});