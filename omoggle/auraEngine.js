/**
 * CarsonGames - Advanced AuraEngine
 * Omoggle 2026
 *
 * Main scoring philosophy:
 * - Stability is the most important factor.
 * - Staying controlled for longer builds Aura.
 * - Sudden movement costs Aura gradually.
 * - Natural blinking is not heavily penalized.
 * - Head movement affects stability.
 * - Mouth/jaw movement is treated as movement/activity,
 *   NOT as an attractiveness or appearance measurement.
 * - Framing and tracking quality affect confidence.
 * - Completely gender-neutral scoring.
 *
 * Compatible with:
 *   AuraEngine.calculateAuraScore(metrics)
 *   AuraEngine.calculateMatchFlux(score)
 *   AuraEngine.generateLiveMetrics()
 *
 * Maximum Aura: 1000
 */

export const AuraEngine = (() => {
  "use strict";

  const CONFIG = Object.freeze({
    maxAura: 1000,
    minAura: 0,
    startingAura: 500,

    analysis: {
      historySize: 90,
      minimumHistory: 6,
      smoothing: 0.16,
      fastSmoothing: 0.28,
      slowSmoothing: 0.08,
      confidenceFloor: 0.25,
      staleAfterMs: 1800
    },

    weights: Object.freeze({
      stability: 0.45,
      blink: 0.15,
      headControl: 0.10,
      framing: 0.10,
      facialActivity: 0.10,
      tracking: 0.10
    }),

    stability: {
      perfectThreshold: 0.025,
      goodThreshold: 0.065,
      okayThreshold: 0.13,
      badThreshold: 0.24,

      buildRate: 0.95,
      lossRate: 1.35,

      maximumBonus: 0.75,
      maximumPenalty: 1.25,

      movementDeadzone: 0.012,

      recoveryRate: 0.20
    },

    blink: {
      naturalMinimum: 0.12,
      naturalMaximum: 0.42,
      excessiveThreshold: 0.65,
      freezeThreshold: 0.025,

      rewardNatural: 1.0,
      penaltyExcessive: 0.65,
      penaltyTooLittle: 0.20
    },

    match: {
      min: 0,
      max: 100,
      startingPosition: 50,

      maxStep: 2.25,
      momentum: 0.28,
      damping: 0.84,
      response: 0.075,

      microMovement: 0.035
    },

    tiers: Object.freeze({
      aura: [
        { min: 950, label: "GODLIKE AURA" },
        { min: 900, label: "ABSOLUTE AURA" },
        { min: 800, label: "MASSIVE AURA" },
        { min: 700, label: "HIGH AURA" },
        { min: 600, label: "SOLID AURA" },
        { min: 500, label: "NEUTRAL AURA" },
        { min: 400, label: "LOW AURA" },
        { min: 250, label: "L AURA" },
        { min: 0, label: "NEGATIVE AURA" }
      ],

      rizz: [
        { min: 0.88, label: "W RIZZ" },
        { min: 0.74, label: "UNSPOKEN RIZZ" },
        { min: 0.55, label: "DECENT RIZZ" },
        { min: 0.38, label: "NEUTRAL CHAT" },
        { min: 0, label: "L RIZZ" }
      ],

      tuff: [
        { min: 0.92, label: "CERTIFIED TUFF" },
        { min: 0.78, label: "EXTREMELY TUFF" },
        { min: 0.63, label: "SOLID FRAME" },
        { min: 0.48, label: "SLIGHTLY GOOFY" },
        { min: 0, label: "CRASH OUT" }
      ]
    })
  });

  const state = {
    initialized: false,

    aura: CONFIG.startingAura,
    previousAura: CONFIG.startingAura,

    position: CONFIG.match.startingPosition,
    velocity: 0,

    stabilityMomentum: 0,
    stabilityTime: 0,

    lastTimestamp: 0,
    lastEvaluation: null,

    history: [],

    video: null,
    canvas: null,
    context: null,

    previousFrame: null,
    previousFaceCenter: null,
    previousFaceSize: null,

    blinkState: {
      closed: false,
      startedAt: 0,
      count: 0,
      lastBlinkAt: 0,
      durations: []
    },

    lastMetrics: {
      stability: 0.5,
      blink: 0.5,
      headControl: 0.5,
      framing: 0.5,
      facialActivity: 0.5,
      tracking: 0.5
    },

    deterministicPhase: 0,

    analyzing: false,
    analysisTimer: null,

    listeners: new Set()
  };

  function clamp(value, min = 0, max = 1) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return min;
    }

    return Math.max(min, Math.min(max, number));
  }

  function clampAura(value) {
    return Math.round(
      Math.max(
        CONFIG.minAura,
        Math.min(
          CONFIG.maxAura,
          Number(value) || 0
        )
      )
    );
  }

  function clampPosition(value) {
    return Math.max(
      CONFIG.match.min,
      Math.min(
        CONFIG.match.max,
        Number(value) || 0
      )
    );
  }

  function lerp(a, b, amount) {
    return a + (b - a) * clamp(amount);
  }

  function average(values) {
    if (!values || values.length === 0) {
      return 0;
    }

    let total = 0;
    let count = 0;

    for (const value of values) {
      const number = Number(value);

      if (Number.isFinite(number)) {
        total += number;
        count++;
      }
    }

    return count ? total / count : 0;
  }

  function standardDeviation(values) {
    if (!values || values.length < 2) {
      return 0;
    }

    const mean = average(values);

    let total = 0;

    for (const value of values) {
      const difference = value - mean;
      total += difference * difference;
    }

    return Math.sqrt(
      total / values.length
    );
  }

  function getTier(value, tiers) {
    for (const tier of tiers) {
      if (value >= tier.min) {
        return tier.label;
      }
    }

    return tiers[tiers.length - 1].label;
  }

  function weightedAverage(metrics) {
    let total = 0;
    let weight = 0;

    for (const key of Object.keys(CONFIG.weights)) {
      const metric = clamp(metrics[key]);
      const metricWeight = CONFIG.weights[key];

      total += metric * metricWeight;
      weight += metricWeight;
    }

    return weight > 0 ? total / weight : 0;
  }

  function initialize() {
    if (state.initialized) {
      return;
    }

    reset();
    state.initialized = true;
  }

  function reset() {
    state.aura = CONFIG.startingAura;
    state.previousAura = CONFIG.startingAura;

    state.position =
      CONFIG.match.startingPosition;

    state.velocity = 0;

    state.stabilityMomentum = 0;
    state.stabilityTime = 0;

    state.lastTimestamp = 0;
    state.lastEvaluation = null;

    state.history.length = 0;

    state.previousFrame = null;
    state.previousFaceCenter = null;
    state.previousFaceSize = null;

    state.blinkState = {
      closed: false,
      startedAt: 0,
      count: 0,
      lastBlinkAt: 0,
      durations: []
    };

    state.lastMetrics = {
      stability: 0.5,
      blink: 0.5,
      headControl: 0.5,
      framing: 0.5,
      facialActivity: 0.5,
      tracking: 0.5
    };

    state.deterministicPhase = 0;
  }

  function normalizeMetrics(input = {}) {
    return {
      stability: clamp(
        input.stability ??
        input.stillness ??
        0.5
      ),

      blink: clamp(
        input.blink ??
        input.blinkScore ??
        0.5
      ),

      headControl: clamp(
        input.headControl ??
        input.headStability ??
        0.5
      ),

      framing: clamp(
        input.framing ??
        input.frameQuality ??
        0.5
      ),

      facialActivity: clamp(
        input.facialActivity ??
        input.expressionActivity ??
        input.mouthActivity ??
        0.5
      ),

      tracking: clamp(
        input.tracking ??
        input.trackingConfidence ??
        input.confidence ??
        0.5
      )
    };
  }

  function calculateTemporalConsistency() {
    if (state.history.length < 5) {
      return 0.5;
    }

    const recent =
      state.history.slice(-25);

    const keys = [
      "stability",
      "blink",
      "headControl",
      "framing",
      "facialActivity",
      "tracking"
    ];

    const scores = [];

    for (const key of keys) {
      const values =
        recent.map(item => item[key]);

      const deviation =
        standardDeviation(values);

      scores.push(
        clamp(1 - deviation / 0.30)
      );
    }

    return average(scores);
  }

  function calculateStabilityFromMovement(movement) {
    movement = Math.max(
      0,
      Number(movement) || 0
    );

    if (
      movement <=
      CONFIG.stability.perfectThreshold
    ) {
      return 1;
    }

    if (
      movement <=
      CONFIG.stability.goodThreshold
    ) {
      const amount =
        (
          movement -
          CONFIG.stability.perfectThreshold
        ) /
        (
          CONFIG.stability.goodThreshold -
          CONFIG.stability.perfectThreshold
        );

      return lerp(
        1,
        0.82,
        amount
      );
    }

    if (
      movement <=
      CONFIG.stability.okayThreshold
    ) {
      const amount =
        (
          movement -
          CONFIG.stability.goodThreshold
        ) /
        (
          CONFIG.stability.okayThreshold -
          CONFIG.stability.goodThreshold
        );

      return lerp(
        0.82,
        0.52,
        amount
      );
    }

    if (
      movement <=
      CONFIG.stability.badThreshold
    ) {
      const amount =
        (
          movement -
          CONFIG.stability.okayThreshold
        ) /
        (
          CONFIG.stability.badThreshold -
          CONFIG.stability.okayThreshold
        );

      return lerp(
        0.52,
        0.15,
        amount
      );
    }

    return clamp(
      0.15 -
      (
        movement -
        CONFIG.stability.badThreshold
      ) * 0.75
    );
  }

  function updateStabilityMomentum(
    stability,
    deltaTime
  ) {
    const normalized =
      clamp(stability);

    const centered =
      normalized - 0.5;

    if (centered > 0) {
      state.stabilityMomentum +=
        centered *
        CONFIG.stability.buildRate *
        deltaTime;

      state.stabilityTime +=
        deltaTime;
    } else {
      state.stabilityMomentum -=
        Math.abs(centered) *
        CONFIG.stability.lossRate *
        deltaTime;

      state.stabilityTime = Math.max(
        0,
        state.stabilityTime -
        deltaTime * 0.5
      );
    }

    state.stabilityMomentum =
      clamp(
        state.stabilityMomentum,
        -CONFIG.stability.maximumPenalty,
        CONFIG.stability.maximumBonus
      );
  }

  function calculateBlinkScore(
    blinkRate = null,
    blinkDuration = null
  ) {
    if (
      blinkRate === null &&
      blinkDuration === null
    ) {
      return state.lastMetrics.blink;
    }

    let score = 1;

    if (blinkRate !== null) {
      const rate =
        Math.max(
          0,
          Number(blinkRate) || 0
        );

      if (
        rate >=
        CONFIG.blink.naturalMinimum &&
        rate <=
        CONFIG.blink.naturalMaximum
      ) {
        score = 1;
      } else if (
        rate >
        CONFIG.blink.excessiveThreshold
      ) {
        score =
          CONFIG.blink.penaltyExcessive;
      } else if (
        rate <
        CONFIG.blink.freezeThreshold
      ) {
        score =
          1 -
          CONFIG.blink.penaltyTooLittle;
      } else if (
        rate <
        CONFIG.blink.naturalMinimum
      ) {
        const difference =
          CONFIG.blink.naturalMinimum -
          rate;

        score =
          1 -
          clamp(
            difference /
            CONFIG.blink.naturalMinimum
          ) *
          CONFIG.blink.penaltyTooLittle;
      } else {
        const difference =
          rate -
          CONFIG.blink.naturalMaximum;

        score =
          1 -
          clamp(
            difference /
            0.5
          ) *
          CONFIG.blink.penaltyExcessive;
      }
    }

    if (
      blinkDuration !== null &&
      Number.isFinite(
        Number(blinkDuration)
      )
    ) {
      const duration =
        Number(blinkDuration);

      if (
        duration > 0.08 &&
        duration < 0.65
      ) {
        score =
          lerp(
            score,
            1,
            0.35
          );
      } else if (
        duration > 1.0
      ) {
        score *= 0.75;
      }
    }

    return clamp(score);
  }

  function updateBlink(
    eyesClosed,
    timestamp
  ) {
    const closed = Boolean(
      eyesClosed
    );

    const blink =
      state.blinkState;

    if (
      closed &&
      !blink.closed
    ) {
      blink.closed = true;
      blink.startedAt = timestamp;
    }

    if (
      !closed &&
      blink.closed
    ) {
      blink.closed = false;

      const duration =
        Math.max(
          0,
          timestamp -
          blink.startedAt
        );

      blink.count++;
      blink.lastBlinkAt =
        timestamp;

      blink.durations.push(
        duration
      );

      if (
        blink.durations.length > 20
      ) {
        blink.durations.shift();
      }
    }

    const elapsed =
      timestamp -
      Math.max(
        0,
        blink.lastBlinkAt
      );

    const minutes =
      elapsed > 0
        ? elapsed / 60000
        : 1;

    const recentCount =
      blink.durations.length;

    const blinkRate =
      recentCount > 0
        ? recentCount /
          Math.max(
            minutes,
            0.25
          )
        : 0;

    const lastDuration =
      blink.durations.length
        ? blink.durations[
            blink.durations.length - 1
          ]
        : null;

    return calculateBlinkScore(
      blinkRate / 20,
      lastDuration
        ? lastDuration / 1000
        : null
    );
  }

  function updateHistory(
    metrics,
    timestamp
  ) {
    state.history.push({
      timestamp,
      ...metrics
    });

    while (
      state.history.length >
      CONFIG.analysis.historySize
    ) {
      state.history.shift();
    }
  }

  function analyzeMeasurement(
    input = {},
    timestamp = performance.now()
  ) {
    initialize();

    const now =
      Number.isFinite(timestamp)
        ? timestamp
        : performance.now();

    let deltaTime =
      state.lastTimestamp
        ? (
            now -
            state.lastTimestamp
          ) / 1000
        : 0.1;

    deltaTime =
      Math.max(
        0.016,
        Math.min(
          0.5,
          deltaTime
        )
      );

    state.lastTimestamp = now;

    const raw =
      normalizeMetrics(input);

    const stability =
      calculateStabilityFromMovement(
        1 -
        raw.stability
      );

    raw.stability =
      lerp(
        raw.stability,
        stability,
        0.5
      );

    updateStabilityMomentum(
      raw.stability,
      deltaTime
    );

    updateHistory(
      raw,
      now
    );

    const temporalConsistency =
      calculateTemporalConsistency();

    raw.tracking =
      lerp(
        raw.tracking,
        temporalConsistency,
        0.15
      );

    for (
      const key of Object.keys(
        state.lastMetrics
      )
    ) {
      const smoothing =
        key === "stability"
          ? CONFIG.analysis.fastSmoothing
          : CONFIG.analysis.smoothing;

      state.lastMetrics[key] =
        lerp(
          state.lastMetrics[key],
          raw[key],
          smoothing
        );
    }

    return createEvaluation();
  }

  function calculateAuraScore(
    metrics = null
  ) {
    initialize();

    if (metrics) {
      return analyzeMeasurement(
        metrics
      );
    }

    return createEvaluation();
  }

  function createEvaluation() {
    const metrics = {
      ...state.lastMetrics
    };

    const weighted =
      weightedAverage(metrics);

    /*
     * Stability gets a special multiplier.
     *
     * This means someone who stays extremely still
     * can actually separate themselves from someone
     * who merely has good framing.
     */
    const stabilityBoost =
      (
        metrics.stability -
        0.5
      ) * 0.24;

    const momentumBoost =
      state.stabilityMomentum *
      0.08;

    const combined =
      clamp(
        weighted +
        stabilityBoost +
        momentumBoost
      );

    const auraScore =
      clampAura(
        combined *
        CONFIG.maxAura
      );

    const rizzScore =
      clamp(
        metrics.facialActivity * 0.35 +
        metrics.blink * 0.20 +
        metrics.framing * 0.20 +
        metrics.stability * 0.15 +
        metrics.tracking * 0.10
      );

    const tuffScore =
      clamp(
        metrics.stability * 0.55 +
        metrics.headControl * 0.20 +
        metrics.framing * 0.10 +
        metrics.tracking * 0.10 +
        metrics.blink * 0.05
      );

    const confidence =
      clamp(
        metrics.tracking * 0.45 +
        metrics.framing * 0.20 +
        metrics.stability * 0.15 +
        metrics.blink * 0.10 +
        temporalConfidence() * 0.10
      );

    const auraLabel =
      getTier(
        auraScore,
        CONFIG.tiers.aura
      );

    const rizzLabel =
      getTier(
        rizzScore,
        CONFIG.tiers.rizz
      );

    const tuffLabel =
      getTier(
        tuffScore,
        CONFIG.tiers.tuff
      );

    const evaluation = {
      auraScore,

      auraPercent:
        auraScore /
        CONFIG.maxAura,

      auraLabel,

      rizzScore,
      rizzLabel,

      tuffScore,
      tuffLabel,

      confidence,

      stabilityMomentum:
        state.stabilityMomentum,

      stabilityTime:
        state.stabilityTime,

      metrics: {
        stability:
          metrics.stability,

        blink:
          metrics.blink,

        headControl:
          metrics.headControl,

        framing:
          metrics.framing,

        facialActivity:
          metrics.facialActivity,

        tracking:
          metrics.tracking
      },

      breakdown: {
        stability:
          Math.round(
            metrics.stability * 100
          ),

        blink:
          Math.round(
            metrics.blink * 100
          ),

        headControl:
          Math.round(
            metrics.headControl * 100
          ),

        framing:
          Math.round(
            metrics.framing * 100
          ),

        facialActivity:
          Math.round(
            metrics.facialActivity * 100
          ),

        tracking:
          Math.round(
            metrics.tracking * 100
          )
      },

      text:
        `Aura: ${auraScore} | ` +
        `[${auraLabel}] ` +
        `[${tuffLabel}] ` +
        `[${rizzLabel}]`
    };

    state.previousAura =
      state.aura;

    state.aura =
      auraScore;

    state.lastEvaluation =
      evaluation;

    return evaluation;
  }

  function temporalConfidence() {
    if (
      state.history.length < 4
    ) {
      return 0.5;
    }

    return calculateTemporalConsistency();
  }

  function deterministicNoise() {
    state.deterministicPhase +=
      0.17;

    return (
      Math.sin(
        state.deterministicPhase *
        1.71
      ) * 0.55 +
      Math.sin(
        state.deterministicPhase *
        0.73
      ) * 0.30 +
      Math.sin(
        state.deterministicPhase *
        2.41
      ) * 0.15
    );
  }

  function calculateMatchFlux(
    currentScore,
    opponentScore = null
  ) {
    initialize();

    let score =
      clampPosition(
        currentScore
      );

    if (
      opponentScore !== null &&
      Number.isFinite(
        Number(opponentScore)
      )
    ) {
      const opponent =
        clampPosition(
          opponentScore
        );

      const difference =
        score -
        opponent;

      state.velocity +=
        difference *
        CONFIG.match.momentum *
        0.01;
    }

    state.velocity *=
      CONFIG.match.damping;

    const micro =
      deterministicNoise() *
      CONFIG.match.microMovement;

    let change =
      state.velocity +
      micro;

    change =
      Math.max(
        -CONFIG.match.maxStep,
        Math.min(
          CONFIG.match.maxStep,
          change
        )
      );

    score =
      clampPosition(
        score + change
      );

    state.position =
      score;

    return score;
  }

  // Neutral camera-performance score. This measures gaze direction,
  // head position/stability, and eye openness—not facial appearance.
  function calculateFocusScore({
    gazeForward = 0.5,
    stillness = 0.5,
    headForward = 0.5,
    eyesOpen = 0.5
  } = {}) {
    const score =
      clamp(gazeForward) * 0.38 +
      clamp(stillness) * 0.27 +
      clamp(headForward) * 0.20 +
      clamp(eyesOpen) * 0.15;

    return Math.round(score * 100);
  }

  function compareEvaluations(
    playerA,
    playerB
  ) {
    if (
      !playerA ||
      !playerB
    ) {
      return 0;
    }

    const a =
      clamp(
        playerA.auraScore /
        CONFIG.maxAura
      );

    const b =
      clamp(
        playerB.auraScore /
        CONFIG.maxAura
      );

    return clamp(
      a - b,
      -1,
      1
    );
  }

  function advantageToPosition(
    advantage
  ) {
    return clampPosition(
      50 +
      clamp(
        advantage,
        -1,
        1
      ) * 50
    );
  }

  function updateMatch(
    playerA,
    playerB,
    currentPosition = 50
  ) {
    initialize();

    const advantage =
      compareEvaluations(
        playerA,
        playerB
      );

    const target =
      advantageToPosition(
        advantage
      );

    const difference =
      target -
      currentPosition;

    const desiredVelocity =
      difference *
      CONFIG.match.response;

    state.velocity =
      lerp(
        state.velocity,
        desiredVelocity,
        0.25
      );

    state.velocity *=
      CONFIG.match.damping;

    const micro =
      deterministicNoise() *
      CONFIG.match.microMovement;

    let delta =
      state.velocity +
      micro;

    delta =
      Math.max(
        -CONFIG.match.maxStep,
        Math.min(
          CONFIG.match.maxStep,
          delta
        )
      );

    const position =
      clampPosition(
        currentPosition +
        delta
      );

    state.position =
      position;

    return {
      position,
      target,
      advantage,
      playerA,
      playerB
    };
  }

  function analyzeFaceBox(
    box,
    confidence = 1
  ) {
    if (!box) {
      return analyzeMeasurement({
        stability: 0,
        blink: state.lastMetrics.blink,
        headControl: 0,
        framing: 0,
        facialActivity: 0,
        tracking: 0
      });
    }

    const x =
      clamp(box.x);

    const y =
      clamp(box.y);

    const width =
      clamp(box.width);

    const height =
      clamp(box.height);

    const centerX =
      x + width / 2;

    const centerY =
      y + height / 2;

    const centerDistance =
      Math.sqrt(
        Math.pow(
          centerX - 0.5,
          2
        ) +
        Math.pow(
          centerY - 0.5,
          2
        )
      );

    const centerScore =
      clamp(
        1 -
        centerDistance /
        Math.SQRT1_2
      );

    const idealArea =
      0.16;

    const area =
      width *
      height;

    const sizeDifference =
      Math.abs(
        area -
        idealArea
      );

    const sizeScore =
      clamp(
        1 -
        sizeDifference /
        0.30
      );

    const framing =
      clamp(
        centerScore * 0.65 +
        sizeScore * 0.35
      );

    let headMovement = 0;
    let stability = 1;

    const currentCenter = {
      x: centerX,
      y: centerY
    };

    if (
      state.previousFaceCenter
    ) {
      const dx =
        centerX -
        state.previousFaceCenter.x;

      const dy =
        centerY -
        state.previousFaceCenter.y;

      headMovement =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      stability =
        calculateStabilityFromMovement(
          headMovement
        );
    }

    state.previousFaceCenter =
      currentCenter;

    const headControl =
      clamp(
        stability * 0.8 +
        clamp(
          1 -
          headMovement / 0.12
        ) * 0.2
      );

    return analyzeMeasurement({
      stability,
      blink:
        state.lastMetrics.blink,
      headControl,
      framing,
      facialActivity:
        state.lastMetrics.facialActivity,
      tracking:
        clamp(confidence)
    });
  }

  function analyzeFaceLandmarks(
    result
  ) {
    if (
      !result ||
      !Array.isArray(
        result.faceLandmarks
      ) ||
      result.faceLandmarks.length === 0
    ) {
      return analyzeMeasurement({
        stability: 0,
        blink: state.lastMetrics.blink,
        headControl: 0,
        framing: 0,
        facialActivity: 0,
        tracking: 0
      });
    }

    const landmarks =
      result.faceLandmarks[0];

    if (
      !landmarks ||
      !landmarks.length
    ) {
      return analyzeMeasurement({
        tracking: 0,
        framing: 0,
        stability: 0
      });
    }

    let minX = 1;
    let maxX = 0;
    let minY = 1;
    let maxY = 0;

    for (
      const landmark of landmarks
    ) {
      if (!landmark) {
        continue;
      }

      minX =
        Math.min(
          minX,
          clamp(landmark.x)
        );

      maxX =
        Math.max(
          maxX,
          clamp(landmark.x)
        );

      minY =
        Math.min(
          minY,
          clamp(landmark.y)
        );

      maxY =
        Math.max(
          maxY,
          clamp(landmark.y)
        );
    }

    const box = {
      x: minX,
      y: minY,
      width:
        maxX - minX,
      height:
        maxY - minY
    };

    return analyzeFaceBox(
      box,
      1
    );
  }

  function getBlendshapeMap(
    blendshapes
  ) {
    const categories =
      blendshapes?.[0]?.categories ||
      blendshapes?.[0] ||
      blendshapes ||
      [];

    const map =
      new Map();

    if (!Array.isArray(categories)) {
      return map;
    }

    for (
      const category of categories
    ) {
      if (!category) {
        continue;
      }

      const name =
        category.categoryName ||
        category.displayName;

      if (!name) {
        continue;
      }

      map.set(
        name,
        clamp(
          Number(
            category.score
          ) || 0
        )
      );
    }

    return map;
  }

  function analyzeBlendshapes(
    blendshapes,
    baseMetrics = {}
  ) {
    const values =
      getBlendshapeMap(
        blendshapes
      );

    if (!values.size) {
      return analyzeMeasurement(
        baseMetrics
      );
    }

    const get = key =>
      values.get(key) || 0;

    /*
     * Eye blink:
     *
     * We deliberately don't reward people for
     * never blinking. Natural blinking gets the
     * best score.
     */
    const leftBlink =
      get("eyeBlinkLeft");

    const rightBlink =
      get("eyeBlinkRight");

    const eyesClosed =
      (
        leftBlink +
        rightBlink
      ) / 2 > 0.55;

    const blinkScore =
      updateBlink(
        eyesClosed,
        performance.now()
      );

    /*
     * Mouth/jaw activity.
     *
     * This is explicitly movement/activity,
     * not jaw attractiveness.
     */
    const mouthActivity =
      clamp(
        (
          get("jawOpen") +
          get("mouthSmileLeft") +
          get("mouthSmileRight") +
          get("mouthFunnel") +
          get("mouthPucker")
        ) / 5 * 1.7
      );

    /*
     * Brow movement is included as facial activity,
     * rather than being treated as an appearance score.
     */
    const browActivity =
      clamp(
        (
          get("browInnerUp") +
          get("browOuterUpLeft") +
          get("browOuterUpRight")
        ) / 3 * 1.5
      );

    const facialActivity =
      clamp(
        mouthActivity * 0.70 +
        browActivity * 0.30
      );

    return analyzeMeasurement({
      ...baseMetrics,
      blink:
        blinkScore,
      facialActivity
    });
  }

  function analyzeFaceResult(
    result
  ) {
    let evaluation =
      analyzeFaceLandmarks(
        result
      );

    if (
      result?.faceBlendshapes
    ) {
      evaluation =
        analyzeBlendshapes(
          result.faceBlendshapes,
          evaluation.metrics
        );
    }

    return evaluation;
  }

  function attachVideo(
    video
  ) {
    if (
      !video ||
      typeof video !== "object"
    ) {
      throw new TypeError(
        "AuraEngine.attachVideo() requires a video element."
      );
    }

    state.video =
      video;

    if (!state.canvas) {
      state.canvas =
        document.createElement(
          "canvas"
        );

      state.canvas.width =
        160;

      state.canvas.height =
        120;

      state.context =
        state.canvas.getContext(
          "2d",
          {
            willReadFrequently:
              true
          }
        );
    }

    return true;
  }

  function analyzeVideoActivity() {
    if (
      !state.video ||
      !state.context ||
      state.video.readyState < 2
    ) {
      return null;
    }

    const width = 160;
    const height = 120;

    if (
      state.canvas.width !== width ||
      state.canvas.height !== height
    ) {
      state.canvas.width =
        width;

      state.canvas.height =
        height;
    }

    try {
      state.context.drawImage(
        state.video,
        0,
        0,
        width,
        height
      );
    } catch {
      return null;
    }

    const image =
      state.context.getImageData(
        0,
        0,
        width,
        height
      );

    const pixels =
      image.data;

    if (!state.previousFrame) {
      state.previousFrame =
        new Uint8ClampedArray(
          pixels
        );

      return {
        movement: 0
      };
    }

    let difference = 0;

    for (
      let i = 0;
      i < pixels.length;
      i += 4
    ) {
      const current =
        (
          pixels[i] +
          pixels[i + 1] +
          pixels[i + 2]
        ) / 3;

      const previous =
        (
          state.previousFrame[i] +
          state.previousFrame[i + 1] +
          state.previousFrame[i + 2]
        ) / 3;

      difference +=
        Math.abs(
          current -
          previous
        ) / 255;
    }

    state.previousFrame =
      new Uint8ClampedArray(
        pixels
      );

    const pixelCount =
      pixels.length / 4;

    const movement =
      difference /
      pixelCount;

    return {
      movement
    };
  }

  function startVideoAnalysis(
    interval = 100
  ) {
    if (state.analyzing) {
      return;
    }

    if (!state.video) {
      throw new Error(
        "Call attachVideo(video) first."
      );
    }

    state.analyzing = true;

    const tick = () => {
      if (!state.analyzing) {
        return;
      }

      const activity =
        analyzeVideoActivity();

      if (activity) {
        const evaluation =
          analyzeMeasurement({
            stability:
              calculateStabilityFromMovement(
                activity.movement
              ),

            blink:
              state.lastMetrics.blink,

            headControl:
              state.lastMetrics.headControl,

            framing:
              state.lastMetrics.framing,

            facialActivity:
              clamp(
                activity.movement *
                2
              ),

            tracking:
              state.lastMetrics.tracking
          });

        emit(evaluation);
      }

      state.analysisTimer =
        setTimeout(
          tick,
          Math.max(
            33,
            interval
          )
        );
    };

    tick();
  }

  function stopVideoAnalysis() {
    state.analyzing =
      false;

    if (
      state.analysisTimer
    ) {
      clearTimeout(
        state.analysisTimer
      );

      state.analysisTimer =
        null;
    }
  }

  function emit(value) {
    for (
      const listener of state.listeners
    ) {
      try {
        listener(value);
      } catch (error) {
        console.error(
          "AuraEngine listener error:",
          error
        );
      }
    }
  }

  function onUpdate(
    listener
  ) {
    if (
      typeof listener !==
      "function"
    ) {
      return () => {};
    }

    state.listeners.add(
      listener
    );

    return () => {
      state.listeners.delete(
        listener
      );
    };
  }

  function getState() {
    return {
      aura:
        clampAura(
          state.aura
        ),

      position:
        clampPosition(
          state.position
        ),

      velocity:
        state.velocity,

      stabilityMomentum:
        state.stabilityMomentum,

      stabilityTime:
        state.stabilityTime,

      historyLength:
        state.history.length,

      analyzing:
        state.analyzing,

      metrics: {
        ...state.lastMetrics
      },

      evaluation:
        state.lastEvaluation
    };
  }

  function generateLiveMetrics() {
    initialize();

    const evaluation =
      createEvaluation();

    return {
      mewing:
        Math.round(
          evaluation.metrics.stability *
          100
        ),

      stability:
        Math.round(
          evaluation.metrics.stability *
          100
        ),

      rizzQuotient:
        Math.round(
          evaluation.rizzScore *
          100
        ),

      eyeFrame:
        evaluation.metrics.stability >=
        0.85
          ? "LOCKED IN"
          : evaluation.metrics.stability >=
            0.65
            ? "STEADY FRAME"
            : "MOVING FRAME",

      eyeMultiplier:
        0.85 +
        evaluation.metrics.stability *
        0.30,

      chinType:
        "FRAME ANALYSIS",

      chinBonus:
        0,

      tuffBonus:
        Math.round(
          (
            evaluation.tuffScore -
            0.5
          ) * 200
        )
    };
  }

  return Object.freeze({
    config: CONFIG,

    initialize,
    reset,

    clamp,
    clampAura,
    clampPosition,

    calculateAuraScore,
    calculateFocusScore,
    generateLiveMetrics,

    analyzeMeasurement,
    analyzeFaceBox,
    analyzeFaceLandmarks,
    analyzeBlendshapes,
    analyzeFaceResult,

    attachVideo,
    startVideoAnalysis,
    stopVideoAnalysis,

    calculateMatchFlux,
    compareEvaluations,
    advantageToPosition,
    updateMatch,

    onUpdate,
    getState
  });
})();