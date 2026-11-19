# Tuning ClipForge on your own footage

ClipForge's highlight scores come from seven explainable factors (coherence, hook, payoff, clarity, visual, novelty, platform fit). Each content mode sets default weights for them. You can adapt those weights to your taste in two ways, and measure the result.

## 1. Rate clips (in the app)

On the **Highlights** page every clip has 👍 / 👎 buttons. Ratings are stored with the clip's factor values (database migration v3 adds `highlights.rating`; your library is backed up before the migration runs).

## 2. Learn weights from your ratings

**Settings → Personal tuning** lists every content mode with its rating counts. With at least **10 rated clips, including 3 or more good and 3 or more bad**, press **Learn from my ratings**:

- The learner looks for weights under which the clips you liked outrank the ones you disliked (pairwise logistic loss).
- It is **regularised toward the mode's defaults**, so a few ratings nudge the weights rather than replace them. Every factor keeps at least 2 points and the weights still sum to 100.
- Quality is reported as **pairwise ranking accuracy on held-out ratings** (stratified k-fold, k ≤ 5), for the default and the learned weights. This measures how often a clip you liked outranks one you didn't, using your own ratings. It is not a prediction of views.
- The learned weights are switched on automatically only when held-out accuracy does not get worse. You can switch them on or off, re-learn, or reset at any time.

New analyses in that mode then use the learned weights. The analysis records `weights_source: "learned"`, and the Highlights page says "scored with your learned weights". Weights set explicitly for one analysis (`factor_weights` in the API) still take precedence.

## 3. Measure against clips you chose by hand

Write a golden file per video with the clips you would have cut:

```json
{
  "video": "/Users/me/Podcasts/episode-41.mp4",
  "content_mode": "podcast",
  "min_duration": 15,
  "max_duration": 60,
  "clips": [
    {"start": 812.4, "end": 851.0, "label": "pricing story"},
    {"start": 1520.0, "end": 1561.5, "label": "hiring mistake"}
  ]
}
```

Then run, from `backend/`:

```bash
uv run python -m clipforge.devtools.evaluate golden/                 # every *.json in a folder
uv run python -m clipforge.devtools.evaluate ep41.json --compare --learned
uv run python -m clipforge.devtools.evaluate ep41.json --weights hook=30,payoff=20
uv run python -m clipforge.devtools.evaluate ep41.json --project pr_xxxx   # score an existing project, no re-analysis
uv run python -m clipforge.devtools.evaluate golden/ --json report.json
```

Predictions are matched to golden clips one-to-one, in rank order, at IoU ≥ 0.5 (`--iou`). The report gives precision, recall, F1, average precision, the mean IoU of matches, mean start/end boundary error in seconds, and the best IoU reached for each golden clip. With several golden files it also prints a micro-averaged `ALL` row.

Videos are analysed in a separate workspace (`<data dir>/eval-workspace`, or `--data-dir`), so evaluation runs never appear in your library. Transcripts and visual analysis are cached there, so comparing weightings only re-scores.

On the generated test podcast (`tests/fixtures/make_test_video.py`), with its four scripted topic segments as golden clips, the default podcast weights score P = R = 100%, mean IoU 0.95, start error 0.7 s and end error 0.3 s. That media is synthetic, so expect lower numbers on real footage. The harness exists to measure exactly that.

## 4. Optional neural speaker detection

Speaker labels drive Speaker Focus framing and the "back-and-forth exchange" evidence in scoring. By default they come from a spectral heuristic. A neural voice encoder can be installed instead: **Settings → Transcription → Speaker detection → Install**, or

```bash
uv run python -m clipforge.devtools.voice_model install                  # downloads 15.7 MB from PyPI once
uv run python -m clipforge.devtools.voice_model install --wheel FILE.whl  # offline, from a wheel you already have
```

- Model: the GE2E voice encoder published with **Resemblyzer 0.1.4** (Apache-2.0; licence copied next to the weights). The wheel's SHA-256 and the weights' SHA-256 are both verified.
- **No PyTorch.** The legacy checkpoint is read by a restricted unpickler that refuses every global except tensor-rebuild helpers. The weights are converted to `.npz`, and the 3-layer LSTM runs in numpy. Its mel front-end matches librosa to within 1e-7 relative error (fixture test). About 1 s per minute of speech on one CPU core.
- Clustering: one d-vector per sentence, then average-linkage agglomerative clustering. The speaker count is chosen by silhouette score (2–4), or one speaker when even the best split leaves groups that sound alike.
- Only the public model file is downloaded. Audio never leaves the machine. Without the model, the spectral method is used.

Measured on generated speech (accuracy = sentences labelled with the right speaker after best label mapping):

| Test | Spectral | Neural |
|---|---|---|
| Two-voice podcast, clean | 100% | 100% |
| Three voices (two male), every sentence through a different random channel (EQ tilt, band-limit, 12–25 dB SNR noise, gain), 5 held-out seeds | 42–64% (mean 47%) | 56–83% (mean 67%) |

These are synthetic TTS voices, so accuracy on real recordings is not established here. The stress test is deliberately harsher than a typical podcast, where each person keeps the same microphone.
