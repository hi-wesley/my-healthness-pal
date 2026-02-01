export function createInsightsView(ctx) {
  const {
    dom,
    DEFAULT_TZ,
    INSIGHTS_ANALYSIS_VERSION,
    fetchInsightsJob,
    SAMPLE_PROFILES,
    CONFIG,
    addDaysToKey,
    computeStressForDay,
    isPlainObject,
    isFiniteNumber,
    toNumber,
    clamp,
    avg,
    sum,
    kgToLb,
    formatNumber,
    formatSigned,
    formatDayLong,
    getTodayKey,
    getCachedInsights,
    putCachedInsights,
    clearCachedInsights,
    normalizeInsightsDays,
    validateInsightsResponse,
  } = ctx;

  let activeInsightsViewKey = null;
  const insightRequestInFlight = new Map();
  const insightRequestSeq = new Map();
  const insightRequestControllers = new Map();

  
    function setInsightText(titleEl, bodyEl, title, body) {
      if (titleEl) titleEl.textContent = title;
      if (bodyEl) bodyEl.textContent = body;
    }
  
    function toToneScore(value) {
      const num = toNumber(value);
      if (num === null) return null;
      return clamp(Math.round(num), 0, 100);
    }
  
    function normalizeInsightBlock(value) {
      if (!isPlainObject(value)) return null;
      const title = typeof value.title === "string" ? value.title.trim() : "";
      const body = typeof value.body === "string" ? value.body.trim() : "";
      if (!title || !body) return null;
      const toneScore = toToneScore(value.toneScore ?? value.score);
      const toneDayKey = typeof value.toneDayKey === "string" ? value.toneDayKey.trim() : "";
      return { title, body, toneScore, toneDayKey: toneDayKey || null };
    }
  
    function setInsightTone(cardEl, toneScore) {
      if (!cardEl) return;
      if (!isFiniteNumber(toneScore)) {
        cardEl.removeAttribute("data-tone");
        cardEl.style.removeProperty("--tone-hue");
        return;
      }
      const score = clamp(toneScore, 0, 100);
      const hue = (score / 100) * 120;
      cardEl.setAttribute("data-tone", "1");
      cardEl.style.setProperty("--tone-hue", String(Math.round(hue)));
    }
  
    function showInsightsGenerating(dayKey) {
      const placeholderTitle = "Generating…";
      const placeholderBody = `Generating AI insights for ${dayKey}…`;
      setInsightText(dom.insights.overallTitle, dom.insights.overallBody, placeholderTitle, placeholderBody);
      setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, placeholderTitle, placeholderBody);
      setInsightText(dom.insights.stressTitle, dom.insights.stressBody, placeholderTitle, placeholderBody);
      setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, placeholderTitle, placeholderBody);
      setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, placeholderTitle, placeholderBody);
      setInsightText(dom.insights.bpTitle, dom.insights.bpBody, placeholderTitle, placeholderBody);
      setInsightText(dom.insights.weightTitle, dom.insights.weightBody, placeholderTitle, placeholderBody);
      setInsightTone(dom.insights.overallTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.exerciseTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.nutritionTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), null);
    }
  
    function renderAiInsights(insights, { expectedDayKey = null, analysisOk = true } = {}) {
      if (!isPlainObject(insights)) return { ok: false, hasTone: false };
  
      const overall = normalizeInsightBlock(insights.overall);
      const sleep = normalizeInsightBlock(insights.sleep);
      const stress = normalizeInsightBlock(insights.stress);
      const exercise = normalizeInsightBlock(insights.exercise);
      const nutrition = normalizeInsightBlock(insights.nutrition);
      const bp = normalizeInsightBlock(insights.bp);
      const weight = normalizeInsightBlock(insights.weight);
  
      const ok = Boolean(overall && sleep && stress && exercise && nutrition && bp && weight);
      const expected =
        typeof expectedDayKey === "string" && expectedDayKey.trim() ? expectedDayKey.trim() : null;
      const canUseTone = ok && analysisOk === true && Boolean(expected);
      const blockHasTone = (block) =>
        Boolean(
          canUseTone &&
          block &&
          isFiniteNumber(block.toneScore) &&
          typeof block.toneDayKey === "string" &&
          block.toneDayKey === expected
        );
      const hasTone =
        ok &&
        [overall, sleep, stress, exercise, nutrition, bp, weight].every((block) =>
          blockHasTone(block)
        );
  
      if (overall) {
        setInsightText(dom.insights.overallTitle, dom.insights.overallBody, overall.title, overall.body);
        setInsightTone(
          dom.insights.overallTitle?.closest?.(".insight"),
          blockHasTone(overall) ? overall.toneScore : null
        );
      }
      if (sleep) {
        setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, sleep.title, sleep.body);
        setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), blockHasTone(sleep) ? sleep.toneScore : null);
      }
      if (stress) {
        setInsightText(dom.insights.stressTitle, dom.insights.stressBody, stress.title, stress.body);
        setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), blockHasTone(stress) ? stress.toneScore : null);
      }
      if (exercise) {
        setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, exercise.title, exercise.body);
        setInsightTone(
          dom.insights.exerciseTitle?.closest?.(".insight"),
          blockHasTone(exercise) ? exercise.toneScore : null
        );
      }
      if (nutrition) {
        setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, nutrition.title, nutrition.body);
        setInsightTone(
          dom.insights.nutritionTitle?.closest?.(".insight"),
          blockHasTone(nutrition) ? nutrition.toneScore : null
        );
      }
      if (bp) {
        setInsightText(dom.insights.bpTitle, dom.insights.bpBody, bp.title, bp.body);
        setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), blockHasTone(bp) ? bp.toneScore : null);
      }
      if (weight) {
        setInsightText(dom.insights.weightTitle, dom.insights.weightBody, weight.title, weight.body);
        setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), blockHasTone(weight) ? weight.toneScore : null);
      }
  
      return { ok, hasTone };
    }
  
    function clampToneScore(value) {
      const score = toToneScore(value);
      return isFiniteNumber(score) ? clamp(score, 0, 100) : null;
    }
  
    function scoreSleepTone(dayByKey, dayKey) {
      const window = windowDays(dayByKey, dayKey, 7);
      const values = window.map((d) => d.sleep_hours).filter(isFiniteNumber);
      if (values.length === 0) return null;
  
      const avgSleep = avg(values);
      if (!isFiniteNumber(avgSleep)) return null;
  
      let score =
        avgSleep >= 7.6
          ? 88
          : avgSleep >= 7.0
            ? 78
            : avgSleep >= 6.5
              ? 68
              : avgSleep >= 6.0
                ? 55
                : avgSleep >= 5.5
                  ? 40
                  : 25;
  
      const shortCount = window.reduce((acc, d) => {
        const v = d.sleep_hours;
        return acc + (isFiniteNumber(v) && v < 6 ? 1 : 0);
      }, 0);
      if (shortCount >= 3) score -= 10;
      if (shortCount >= 5) score -= 8;
  
      return clampToneScore(score);
    }
  
    function scoreStressTone(dayByKey, dayKey) {
      const prevDayKey = addDaysToKey(dayKey, -1);
      const stress = computeStressForDay(dayByKey, prevDayKey, CONFIG);
      return clampToneScore(stress?.score ?? null);
    }
  
    function scoreExerciseTone(dayByKey, dayKey) {
      const window = windowDays(dayByKey, dayKey, 7);
      const mins = window.map((d) => d.workout_minutes).filter(isFiniteNumber);
      if (mins.length === 0) return null;
      const total = sum(mins);
  
      const score =
        total >= 210
          ? 88
          : total >= 150
            ? 78
            : total >= 90
              ? 62
              : total >= 45
                ? 48
                : total > 0
                  ? 32
                  : 20;
      return clampToneScore(score);
    }
  
    function scoreNutritionTone(profileId, dayByKey, dayKey) {
      const day = dayByKey.get(dayKey) ?? null;
      const calories = day && isFiniteNumber(day.calories) ? day.calories : null;
      const protein = day && isFiniteNumber(day.protein_g) ? day.protein_g : null;
      const sugar = day && isFiniteNumber(day.sugar_g) ? day.sugar_g : null;
      if (calories === null && protein === null && sugar === null) return null;
  
      let score = 74;
  
      if (isFiniteNumber(protein)) {
        if (protein < 45) score -= 55;
        else if (protein < 60) score -= 42;
        else if (protein < 80) score -= 28;
        else if (protein < 110) score -= 14;
        else score += 6;
      } else {
        score -= 10;
      }
  
      if (isFiniteNumber(sugar)) {
        if (sugar > 90) score -= 28;
        else if (sugar > 70) score -= 18;
        else if (sugar > 55) score -= 10;
        else if (sugar > 40) score -= 6;
      }
  
      if (isFiniteNumber(calories)) {
        if (profileId === "weightloss-wally") {
          if (calories > 3000) score -= 32;
          else if (calories > 2700) score -= 22;
          else if (calories > 2450) score -= 14;
          else if (calories < 1700) score -= 10;
        } else if (profileId === "athlete-anna") {
          if (calories < 2300) score -= 10;
        } else {
          if (calories > 3400) score -= 12;
          else if (calories < 1600) score -= 12;
        }
      }
  
      if (profileId === "athlete-anna" && isFiniteNumber(calories) && isFiniteNumber(protein) && calories > 0) {
        const proteinPct = (protein * 4) / calories;
        if (proteinPct >= 0.27) score += 10;
        else if (proteinPct >= 0.23) score += 6;
        else if (proteinPct < 0.17) score -= 14;
        else if (proteinPct < 0.14) score -= 26;
      }
  
      if (profileId === "protein-paul" && isFiniteNumber(protein)) {
        if (protein < 55) score -= 14;
        if (protein < 45) score -= 10;
      }
  
      return clampToneScore(score);
    }
  
    function scoreBpTone(dayByKey, dayKey) {
      const window = windowDays(dayByKey, dayKey, 30);
      const latest = latestBpReading(window);
      if (!latest) return null;
      const sys = latest.systolic;
      const dia = latest.diastolic;
  
      let score = 80;
      if (sys >= 160 || dia >= 100) score = 18;
      else if (sys >= 140 || dia >= 90) score = 35;
      else if (sys >= 130 || dia >= 80) score = 55;
      else if (sys >= 120 && dia < 80) score = 72;
      else score = 86;
  
      return clampToneScore(score);
    }
  
    function scoreWeightTone(profileId, dayByKey, dayKey) {
      const window = windowDays(dayByKey, dayKey, 30);
      const first = firstNumberInDays(window, "weight_kg");
      const latest = latestNumberInDays(window, "weight_kg");
      if (!first || !latest || !isFiniteNumber(first.value) || !isFiniteNumber(latest.value)) return null;
  
      const deltaLb = kgToLb(latest.value) - kgToLb(first.value);
      let score = 75;
  
      if (profileId === "weightloss-wally") {
        score = deltaLb <= -2.5 ? 86 : deltaLb <= -1.0 ? 76 : deltaLb <= 0.5 ? 64 : 48;
      } else {
        const abs = Math.abs(deltaLb);
        score = abs < 2 ? 80 : abs < 4 ? 68 : abs < 7 ? 54 : 40;
      }
  
      return clampToneScore(score);
    }
  
    function computeLocalToneScores(profileId, dayKey, model) {
      const days = Array.isArray(model?.days) ? model.days : [];
      const dayByKey = new Map(days.map((d) => [d.dayKey, d]));
  
      const sleep = scoreSleepTone(dayByKey, dayKey);
      const stress = scoreStressTone(dayByKey, dayKey);
      const exercise = scoreExerciseTone(dayByKey, dayKey);
      const nutrition = scoreNutritionTone(profileId, dayByKey, dayKey);
      const bp = scoreBpTone(dayByKey, dayKey);
      const weight = scoreWeightTone(profileId, dayByKey, dayKey);
  
      const components = [sleep, stress, exercise, nutrition, bp, weight].filter(isFiniteNumber);
      const overall = components.length > 0 ? clampToneScore(avg(components)) : null;
  
      return { overall, sleep, stress, exercise, nutrition, bp, weight };
    }
  
    function applyLocalToneScores(profileId, dayKey, model, insights) {
      if (!isPlainObject(insights)) return insights;
      const scores = computeLocalToneScores(profileId, dayKey, model);
      const withTone = (block, score) => {
        if (!isPlainObject(block)) return block;
        if (!isFiniteNumber(score)) return { ...block, toneScore: null, toneDayKey: null };
        return { ...block, toneScore: score, toneDayKey: dayKey };
      };
  
      return {
        overall: withTone(insights.overall, scores.overall),
        sleep: withTone(insights.sleep, scores.sleep),
        stress: withTone(insights.stress, scores.stress),
        exercise: withTone(insights.exercise, scores.exercise),
        nutrition: withTone(insights.nutrition, scores.nutrition),
        bp: withTone(insights.bp, scores.bp),
        weight: withTone(insights.weight, scores.weight),
      };
    }
  
    function isCurrentInsightsAnalysisVersion(value) {
      const num = toNumber(value);
      return Number.isFinite(num) && num === INSIGHTS_ANALYSIS_VERSION;
    }
  
    async function ensureAiInsights(profileId, dayKey, model, options = {}) {
      const force = isPlainObject(options) && options.force === true;
      const requestKey = `${profileId}:${dayKey}`;
      if (!force) {
        const existing = insightRequestInFlight.get(requestKey);
        if (existing) return existing;
      } else {
        const controller = insightRequestControllers.get(requestKey);
        if (controller) controller.abort();
        insightRequestInFlight.delete(requestKey);
      }
  
      const seq = (insightRequestSeq.get(requestKey) ?? 0) + 1;
      insightRequestSeq.set(requestKey, seq);
      const controller = new AbortController();
      insightRequestControllers.set(requestKey, controller);
  
      const promise = (async () => {
        if (!force) {
          const cached = getCachedInsights(profileId, dayKey);
          if (cached) {
            const rendered = renderAiInsights(cached.insights, {
              expectedDayKey: dayKey,
              analysisOk: isCurrentInsightsAnalysisVersion(cached.analysisVersion),
            });
            if (rendered.ok && rendered.hasTone) return;
          }
        }
  
        const profile = SAMPLE_PROFILES[profileId] ?? null;
        const profileName = profile?.name ?? (typeof model?.userName === "string" ? model.userName : profileId);
        const { timeZone, days } = normalizeInsightsDays({
          model,
          dayKey,
          defaultTimeZone: DEFAULT_TZ,
          addDaysToKey,
          computeStressForDay,
          isFiniteNumber,
          config: CONFIG,
        });
  
        const data = await fetchInsightsJob({
          payload: { profileId, profileName, dayKey, timeZone, days },
          signal: controller.signal,
          timeoutMs: 90_000,
        });
        const validated = validateInsightsResponse(data);
        if (!validated.ok) throw new Error(validated.error);
  
        const latestSeq = insightRequestSeq.get(requestKey) ?? 0;
        if (seq !== latestSeq) return;
        if (insightRequestControllers.get(requestKey) !== controller) return;
  
        const scoredInsights = applyLocalToneScores(profileId, dayKey, model, validated.insights);

        putCachedInsights(profileId, dayKey, {
          model: validated.model,
          analysisVersion: INSIGHTS_ANALYSIS_VERSION,
          insights: scoredInsights,
        });
        if (activeInsightsViewKey === requestKey) {
          renderAiInsights(scoredInsights, { expectedDayKey: dayKey, analysisOk: true });
        }
      })()
        .catch((err) => {
          if (err && typeof err === "object" && err.name === "AbortError") return;
          throw err;
        })
        .finally(() => {
          if (insightRequestInFlight.get(requestKey) === promise) {
            insightRequestInFlight.delete(requestKey);
          }
          if (insightRequestControllers.get(requestKey) === controller) {
            insightRequestControllers.delete(requestKey);
          }
        });
  
      insightRequestInFlight.set(requestKey, promise);
      return promise;
    }
  
    function renderInsights(model) {
      activeInsightsViewKey = null;
      const hasData = isPlainObject(model) && Array.isArray(model.days) && model.days.length > 0;
      const maxDayKey = hasData && typeof model.maxDayKey === "string" ? model.maxDayKey : null;
      const asOf = maxDayKey ? formatDayLong(maxDayKey) : null;
  
      if (!hasData) {
        setInsightText(dom.insights.overallTitle, dom.insights.overallBody, "—", "—");
        setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, "—", "—");
        setInsightText(dom.insights.stressTitle, dom.insights.stressBody, "—", "—");
        setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, "—", "—");
        setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, "—", "—");
        setInsightText(dom.insights.bpTitle, dom.insights.bpBody, "—", "—");
        setInsightText(dom.insights.weightTitle, dom.insights.weightBody, "—", "—");
        setInsightTone(dom.insights.overallTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.exerciseTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.nutritionTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), null);
        return;
      }
  
      const todayKey = getTodayKey(model.timeZone);
      const profileId = typeof model.userId === "string" && model.userId ? model.userId : null;
      const isSample = Boolean(profileId && profileId in SAMPLE_PROFILES);
      if (isSample && profileId) activeInsightsViewKey = `${profileId}:${todayKey}`;
  
      let hasUsableCached = false;
      let cachedHasTone = false;
      if (isSample) {
        const cached = getCachedInsights(profileId, todayKey);
        if (cached) {
          const rendered = renderAiInsights(cached.insights, {
            expectedDayKey: todayKey,
            analysisOk: isCurrentInsightsAnalysisVersion(cached.analysisVersion),
          });
          hasUsableCached = rendered.ok;
          cachedHasTone = rendered.ok && rendered.hasTone;
          if (cachedHasTone) return;
        }
      }
  
      if (!hasUsableCached) {
        const placeholderTitle = isSample ? "Generating…" : "Not generated yet";
        const placeholderBody = isSample
          ? `Generating AI insights for ${todayKey}…`
          : "Start the backend to generate AI insights.";
  
        setInsightText(
          dom.insights.overallTitle,
          dom.insights.overallBody,
          placeholderTitle,
          asOf ? `As of ${asOf}, ${placeholderBody}` : placeholderBody
        );
        setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, placeholderTitle, placeholderBody);
        setInsightText(dom.insights.stressTitle, dom.insights.stressBody, placeholderTitle, placeholderBody);
        setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, placeholderTitle, placeholderBody);
        setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, placeholderTitle, placeholderBody);
        setInsightText(dom.insights.bpTitle, dom.insights.bpBody, placeholderTitle, placeholderBody);
        setInsightText(dom.insights.weightTitle, dom.insights.weightBody, placeholderTitle, placeholderBody);
        setInsightTone(dom.insights.overallTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.exerciseTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.nutritionTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), null);
        setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), null);
      }
  
      if (!isSample) return;
      if (window.location.protocol === "file:") return;
  
      if (maxDayKey && maxDayKey < todayKey) {
        setInsightText(
          dom.insights.overallTitle,
          dom.insights.overallBody,
          "Not ready yet",
          `Today's data (${todayKey}) hasn't been generated yet.`
        );
        return;
      }
  
      void ensureAiInsights(profileId, todayKey, model).catch((err) => {
        if (hasUsableCached) return;
        const message = String(err?.message || err || "Could not generate AI insights.");
        setInsightText(dom.insights.overallTitle, dom.insights.overallBody, "AI insights unavailable", message);
        setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.stressTitle, dom.insights.stressBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.bpTitle, dom.insights.bpBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.weightTitle, dom.insights.weightBody, "AI insights unavailable", "—");
      });
    }
  
    async function regenerateAiInsightsForCurrentDay() {
      if (!currentModel) return;
      const profileId =
        typeof currentModel.userId === "string" && currentModel.userId.trim()
          ? currentModel.userId.trim()
          : null;
      if (!profileId) return;
  
      const todayKey = getTodayKey(currentModel.timeZone);
      activeInsightsViewKey = `${profileId}:${todayKey}`;
      clearCachedInsights(profileId, todayKey);
      showInsightsGenerating(todayKey);
  
      if (window.location.protocol === "file:") return;
      try {
        await ensureAiInsights(profileId, todayKey, currentModel, { force: true });
      } catch (err) {
        const message = String(err?.message || err || "Could not regenerate AI insights.");
        setInsightText(dom.insights.overallTitle, dom.insights.overallBody, "AI insights unavailable", message);
        setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.stressTitle, dom.insights.stressBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.bpTitle, dom.insights.bpBody, "AI insights unavailable", "—");
        setInsightText(dom.insights.weightTitle, dom.insights.weightBody, "AI insights unavailable", "—");
      }
    }

  return {
    renderInsights,
    regenerateAiInsightsForCurrentDay,
    setActiveInsightsViewKey: (value) => { activeInsightsViewKey = value; },
    getActiveInsightsViewKey: () => activeInsightsViewKey,
  };
}
