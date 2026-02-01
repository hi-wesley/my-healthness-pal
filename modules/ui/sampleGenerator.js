export function createSampleGenerator(ctx) {
  const {
    SAMPLE_PROFILES,
    SAMPLE_PROFILE_DEFAULT,
    isSampleProfileId,
    CONFIG,
    DEFAULT_TZ,
    isPlainObject,
    isFiniteNumber,
    toNumber,
    clamp,
    clamp01,
    avg,
    sum,
    lbToKg,
    kgToLb,
    validateTimeZone,
    formatDayKey,
    addDaysToKey,
  } = ctx;

  
    function hashSeed(str) {
      let h = 2166136261;
      const s = String(str ?? "");
      for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }
  
    function makeRng(seedString) {
      let state = hashSeed(seedString) >>> 0;
      return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 2 ** 32;
      };
    }
  
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }
  
    function randNormal(rng) {
      let u = 0;
      let v = 0;
      while (u === 0) u = rng();
      while (v === 0) v = rng();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }
  
    function dayOfWeekFromDayKey(dayKey) {
      return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
    }
  
    function parseDayKeyParts(dayKey) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey ?? ""));
      if (!m) return null;
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      return { year, month, day };
    }
  
    const zonedPartsFormatterCache = new Map();
    function getZonedParts(date, timeZone) {
      const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
      let fmt = zonedPartsFormatterCache.get(tz);
      if (!fmt) {
        fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        zonedPartsFormatterCache.set(tz, fmt);
      }
      const parts = fmt.formatToParts(date);
      const out = {};
      for (const p of parts) {
        if (p.type === "year") out.year = Number(p.value);
        if (p.type === "month") out.month = Number(p.value);
        if (p.type === "day") out.day = Number(p.value);
        if (p.type === "hour") out.hour = Number(p.value);
        if (p.type === "minute") out.minute = Number(p.value);
      }
      return {
        year: out.year,
        month: out.month,
        day: out.day,
        hour: out.hour,
        minute: out.minute,
      };
    }
  
    function zonedDateTimeToUtc(dayKey, hour, minute, timeZone) {
      const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
      const parts = parseDayKeyParts(dayKey);
      if (!parts) return new Date(`${dayKey}T00:00:00Z`);
      const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
      let guess = new Date(desiredUtc);
  
      for (let i = 0; i < 3; i += 1) {
        const actual = getZonedParts(guess, tz);
        const actualAsUtc = Date.UTC(
          actual.year,
          actual.month - 1,
          actual.day,
          actual.hour,
          actual.minute,
          0,
          0
        );
        const diff = desiredUtc - actualAsUtc;
        if (Math.abs(diff) < 1000) break;
        guess = new Date(guess.getTime() + diff);
      }
  
      return guess;
    }
  
    function pickIntensity(exerciseCfg, rng) {
      const easyPct = isFiniteNumber(exerciseCfg?.easyPct) ? exerciseCfg.easyPct : 0;
      const hardPct = isFiniteNumber(exerciseCfg?.hardPct) ? exerciseCfg.hardPct : 0;
      const r = rng();
      if (r < easyPct) return "easy";
      if (r < easyPct + hardPct) return "hard";
      return "moderate";
    }
  
    function buildWorkoutsForDay(profile, { dayKey, dow, storyT, rng }) {
      const exerciseCfg = profile.exercise;
      if (!exerciseCfg || !Array.isArray(exerciseCfg.weekdays) || !exerciseCfg.weekdays.includes(dow)) {
        return [];
      }
  
      const maxPerDay = Math.max(
        1,
        Math.min(2, Number.isFinite(exerciseCfg.maxWorkoutsPerDay) ? exerciseCfg.maxWorkoutsPerDay : 1)
      );
      const workoutCount = maxPerDay === 2 && rng() < 0.2 ? 2 : 1;
  
      const activities = Array.isArray(exerciseCfg.activities) && exerciseCfg.activities.length > 0
        ? exerciseCfg.activities
        : ["Workout"];
  
      const baseDuration = lerp(exerciseCfg.durationStart, exerciseCfg.durationEnd, storyT);
      const sd = isFiniteNumber(exerciseCfg.sdMinutes) ? exerciseCfg.sdMinutes : 10;
      const out = [];
  
      for (let i = 0; i < workoutCount; i += 1) {
        const activity = activities[(hashSeed(`${dayKey}:${i}:${profile.name}`) + dow) % activities.length];
        const durationMin = clamp(
          Math.round((baseDuration * (i === 0 ? 1 : 0.55)) + randNormal(rng) * sd),
          12,
          160
        );
        out.push({
          activity,
          durationMin,
          intensity: pickIntensity(exerciseCfg, rng),
          startHour: Number.isFinite(exerciseCfg.startHour) ? exerciseCfg.startHour : 17,
          startMinute: Number.isFinite(exerciseCfg.startMinute) ? exerciseCfg.startMinute : 45,
          caloriesPerMin: isFiniteNumber(exerciseCfg.caloriesPerMin) ? exerciseCfg.caloriesPerMin : 7.5,
        });
      }
  
      return out;
    }
  
    function buildSampleProfilePayload(profileId, timeZone, opts = {}) {
      if (!isSampleProfileId(profileId)) {
        throw new Error(`Unknown sample profile: ${profileId}`);
      }
      const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
      const profile = SAMPLE_PROFILES[profileId] ?? SAMPLE_PROFILES[SAMPLE_PROFILE_DEFAULT];
  
      const endDayKey =
        isDayKey(opts.endDayKey) ? opts.endDayKey : formatDayKey(new Date(), tz);
      const stressSpikeDayKey = addDaysToKey(endDayKey, -1);
      const wantsStressSpike =
        profileId === "protein-paul" || profileId === "hypertension-holly" || profileId === "chronic-chloe";
      const warmupDays = CONFIG.baselineLookbackDays;
      const storyDays = SAMPLE_VISIBLE_DAYS;
      const startDayKey = isDayKey(opts.startDayKey)
        ? opts.startDayKey
        : addDaysToKey(endDayKey, -(SAMPLE_TOTAL_DAYS - 1));
  
      const startUtc = new Date(`${startDayKey}T00:00:00Z`);
      const endUtc = new Date(`${endDayKey}T00:00:00Z`);
      const totalDays =
        Number.isFinite(startUtc.getTime()) && Number.isFinite(endUtc.getTime())
          ? Math.max(
            1,
            Math.round((endUtc.getTime() - startUtc.getTime()) / 86400000) + 1
          )
          : SAMPLE_TOTAL_DAYS;
  
      const rng = makeRng(`${profileId}:${startDayKey}`);
      const records = [];
  
      let weightLb = profile.weight.lbStart + randNormal(rng) * 0.4;
      let prevWorkoutLoad = 0;
  
      for (let i = 0; i < totalDays; i += 1) {
        const dayKey = addDaysToKey(startDayKey, i);
        const dow = dayOfWeekFromDayKey(dayKey);
        const isWeekend = dow === 0 || dow === 6;
        const storyT =
          i < warmupDays
            ? 0
            : clamp01((i - warmupDays) / Math.max(1, storyDays - 1));
  
        // Sleep session (ends on dayKey morning)
        const wakeCfg = isWeekend ? profile.sleep.wakeWeekend : profile.sleep.wakeWeekday;
        const wakeBase = zonedDateTimeToUtc(dayKey, wakeCfg.hour, wakeCfg.minute, tz);
        const wakeJitterMs =
          randNormal(rng) * (isFiniteNumber(profile.sleep.wakeJitterMin) ? profile.sleep.wakeJitterMin : 15) * 60000;
        const wake = new Date(wakeBase.getTime() + wakeJitterMs);
  
        const sleepMean =
          lerp(profile.sleep.meanStart, profile.sleep.meanEnd, storyT) +
          (isWeekend ? profile.sleep.weekendDelta : 0);
        let sleepHours = clamp(
          sleepMean + randNormal(rng) * profile.sleep.sdHours,
          profile.sleep.minHours,
          profile.sleep.maxHours
        );
        if (wantsStressSpike && dayKey === stressSpikeDayKey) {
          sleepHours = clamp(Math.min(sleepHours - 1.4, 5.6), profile.sleep.minHours, profile.sleep.maxHours);
        }
  
        const sleepStart = new Date(wake.getTime() - sleepHours * 60 * 60 * 1000);
        const respiration = clamp(
          (profile.sleep.respirationBase ?? 15.4) + randNormal(rng) * 0.9 + (sleepHours < 6 ? 1.2 : 0),
          10,
          22
        );
        const quality = clamp01(0.62 + (sleepHours - 7) * 0.08 + randNormal(rng) * 0.06);
  
        records.push({
          type: "sleep_session",
          start: sleepStart.toISOString(),
          end: wake.toISOString(),
          data: {
            quality: Number(quality.toFixed(2)),
            respiration_rpm: Number(respiration.toFixed(1)),
          },
          source: profile.sources.sleep,
        });
  
        // Exercise (not every day)
        const workouts = buildWorkoutsForDay(profile, { dayKey, dow, storyT, rng });
        let dayWorkoutLoad = 0;
        let dayWorkoutCalories = 0;
        for (let w = 0; w < workouts.length; w += 1) {
          const item = workouts[w];
          const start = zonedDateTimeToUtc(dayKey, item.startHour, item.startMinute, tz);
          const end = new Date(start.getTime() + item.durationMin * 60000);
          const intensityFactor =
            item.intensity === "hard" ? 1.35 : item.intensity === "easy" ? 0.8 : 1.0;
          const calories = Math.round(item.durationMin * item.caloriesPerMin * intensityFactor);
          dayWorkoutLoad += item.durationMin * intensityFactor;
          dayWorkoutCalories += calories;
  
          records.push({
            type: "workout",
            start: start.toISOString(),
            end: end.toISOString(),
            data: {
              activity: item.activity,
              duration_min: item.durationMin,
              calories,
              intensity: item.intensity,
            },
            source: profile.sources.workout,
          });
        }
  
        // Resting HR (morning)
        const rhrBase = lerp(profile.rhr.baseStart, profile.rhr.baseEnd, storyT);
        const rhr = clamp(
          rhrBase +
          randNormal(rng) * profile.rhr.sd +
          (sleepHours < 6 ? profile.rhr.poorSleepBpmDelta : 0) +
          (prevWorkoutLoad > 0 ? (prevWorkoutLoad / 60) * profile.rhr.prevLoadBpmPerHour : 0),
          42,
          120
        );
        const rhrTs = zonedDateTimeToUtc(dayKey, profile.rhr.time.hour, profile.rhr.time.minute, tz);
        records.push({
          type: "resting_heart_rate",
          timestamp: rhrTs.toISOString(),
          data: { bpm: Math.round(rhr) },
          source: profile.sources.sleep,
        });
  
        // Nutrition (daily)
        const calMean =
          lerp(profile.nutrition.caloriesStart, profile.nutrition.caloriesEnd, storyT) +
          (isWeekend ? profile.nutrition.weekendDelta : 0);
        let calories = Math.round(calMean + randNormal(rng) * profile.nutrition.sdCalories);
        calories = clamp(calories, profile.nutrition.minCalories, profile.nutrition.maxCalories);
  
        let protein_g = Math.round(
          lerp(profile.nutrition.proteinStart, profile.nutrition.proteinEnd, storyT) +
          randNormal(rng) * profile.nutrition.sdProtein
        );
        protein_g = clamp(protein_g, profile.nutrition.minProtein, profile.nutrition.maxProtein);
  
        let fat_g = Math.round(
          lerp(profile.nutrition.fatStart, profile.nutrition.fatEnd, storyT) +
          randNormal(rng) * profile.nutrition.sdFat
        );
        fat_g = clamp(fat_g, profile.nutrition.minFat, profile.nutrition.maxFat);
  
        let sugar_g = Math.round(
          (profile.nutrition.sugarBase ?? 32) +
          randNormal(rng) * (profile.nutrition.sugarSd ?? 12) +
          (sleepHours < 6 ? profile.nutrition.poorSleepSugarDelta : 0)
        );
        sugar_g = clamp(sugar_g, 5, 200);
  
        const remaining = Math.max(0, calories - protein_g * 4 - fat_g * 9);
        let carbs_g = Math.round(remaining / 4);
        carbs_g = clamp(carbs_g, profile.nutrition.minCarbs, profile.nutrition.maxCarbs);
  
        const nutritionTs = zonedDateTimeToUtc(
          dayKey,
          profile.nutrition.time.hour,
          profile.nutrition.time.minute,
          tz
        );
        records.push({
          type: "nutrition",
          timestamp: nutritionTs.toISOString(),
          data: { calories, carbs_g, protein_g, fat_g, sugar_g },
          source: profile.sources.nutrition,
        });
  
        // Blood pressure (daily)
        const sys =
          lerp(profile.bp.sysStart, profile.bp.sysEnd, storyT) +
          randNormal(rng) * profile.bp.sdSys +
          (sleepHours < 6 ? profile.bp.poorSleepSysDelta : 0);
        const dia =
          lerp(profile.bp.diaStart, profile.bp.diaEnd, storyT) +
          randNormal(rng) * profile.bp.sdDia +
          (sleepHours < 6 ? profile.bp.poorSleepDiaDelta : 0);
        const bpTs = zonedDateTimeToUtc(dayKey, profile.bp.time.hour, profile.bp.time.minute, tz);
        records.push({
          type: "blood_pressure",
          timestamp: bpTs.toISOString(),
          data: {
            systolic: clamp(Math.round(sys), 90, 200),
            diastolic: clamp(Math.round(dia), 55, 130),
            unit: "mmHg",
          },
          source: profile.sources.bp,
        });
  
        // Weight (daily)
        const targetWeight = lerp(profile.weight.lbStart, profile.weight.lbEnd, storyT);
        const pull = (targetWeight - weightLb) * profile.weight.follow;
        const noise = randNormal(rng) * profile.weight.sd;
        const workoutEffect =
          dayWorkoutCalories > 0 ? -(dayWorkoutCalories / 3500) * profile.weight.workoutFactor : 0;
        weightLb += pull + noise + workoutEffect;
  
        const weightTs = zonedDateTimeToUtc(
          dayKey,
          profile.weight.time.hour,
          profile.weight.time.minute,
          tz
        );
        records.push({
          type: "weight",
          timestamp: weightTs.toISOString(),
          data: { lb: Number(weightLb.toFixed(1)) },
          source: profile.sources.weight,
        });
  
        // Steps (daily)
        const stepsBase = lerp(profile.steps.baseStart, profile.steps.baseEnd, storyT);
        let steps = Math.round(stepsBase + randNormal(rng) * profile.steps.sd);
        if (workouts.length > 0) steps += profile.steps.workoutBonus;
        steps = clamp(steps, 1800, 26000);
        const stepsTs = zonedDateTimeToUtc(dayKey, profile.steps.time.hour, profile.steps.time.minute, tz);
        records.push({
          type: "steps",
          timestamp: stepsTs.toISOString(),
          data: { count: steps },
          source: profile.sources.sleep,
        });
  
        prevWorkoutLoad = dayWorkoutLoad;
      }
  
      return {
        schemaVersion: 1,
        user: { id: profileId, name: profile.name, tz },
        records,
      };
    }

  return { buildSampleProfilePayload };
}
