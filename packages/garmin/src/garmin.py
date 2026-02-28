#!/usr/bin/env python3
"""
Garmin Connect CLI — Exercise data via garminconnect library.

Usage:
  python3 src/lib/garmin.py setup                  — Interactive first-time login
  python3 src/lib/garmin.py summary [YYYY-MM-DD]   — Body Battery, steps, stress, HR
  python3 src/lib/garmin.py activities [N]          — N most recent activities (default 5)
  python3 src/lib/garmin.py runs [N]                — N most recent running activities
  python3 src/lib/garmin.py training                — Training status, load, VO2 max

Tokens are cached at data/garmin-tokens/ (garth directory format).
Run 'setup' once to log in interactively; subsequent calls auto-refresh.

Requires: pip install garminconnect
"""

import sys
import json
import os
from datetime import date, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent  # src/lib/ -> src/ -> project root
TOKEN_STORE = PROJECT_ROOT / "data" / "garmin-tokens"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_env():
    """Load .env file into os.environ (no-op if missing)."""
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())


def today_str():
    return date.today().isoformat()


def error(msg):
    print(json.dumps({"error": msg}), flush=True)
    sys.exit(1)


def get_client():
    """Load an authenticated Garmin client from cached tokens."""
    if not TOKEN_STORE.exists():
        error(
            f"No Garmin tokens found at {TOKEN_STORE}. "
            "Run: python3 src/lib/garmin.py setup"
        )
    try:
        from garminconnect import Garmin
        client = Garmin()
        client.login(tokenstore=str(TOKEN_STORE))
        return client
    except ImportError:
        error("garminconnect not installed. Run: pip install garminconnect")
    except Exception as e:
        error(
            f"Token login failed: {e}. "
            "Run: python3 src/lib/garmin.py setup"
        )


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_setup():
    """Interactive first-time Garmin login. Saves tokens for future use."""
    load_env()
    email = os.environ.get("GARMIN_EMAIL", "").strip()
    password = os.environ.get("GARMIN_PASSWORD", "").strip()

    if not email or not password:
        error("GARMIN_EMAIL and GARMIN_PASSWORD must be set in .env for setup")

    try:
        from garminconnect import Garmin
    except ImportError:
        error("garminconnect not installed. Run: pip install garminconnect")

    def prompt_mfa():
        return input("Enter MFA/2FA code (or press Enter if not enabled): ").strip()

    try:
        client = Garmin(email=email, password=password, prompt_mfa=prompt_mfa)
        client.login()
        TOKEN_STORE.mkdir(parents=True, exist_ok=True)
        client.garth.dump(str(TOKEN_STORE))
        print(json.dumps({
            "ok": True,
            "message": f"Logged in as {email}. Tokens saved to {TOKEN_STORE}"
        }), flush=True)
    except Exception as e:
        error(f"Login failed: {e}")


def cmd_summary(target_date=None):
    """Body Battery, steps, stress, resting HR, training readiness."""
    client = get_client()
    d = target_date or today_str()
    result = {"date": d}

    # Body Battery
    try:
        bb_data = client.get_body_battery(d, d)
        if bb_data and isinstance(bb_data, list):
            levels = []
            for entry in bb_data:
                if isinstance(entry, dict):
                    for key in ("charged", "level", "bodyBattery"):
                        val = entry.get(key)
                        if val is not None:
                            levels.append(int(val))
                            break
                elif isinstance(entry, (int, float)):
                    levels.append(int(entry))
            if levels:
                result["body_battery"] = {
                    "max": max(levels),
                    "min": min(levels),
                    "current": levels[-1],
                }
    except Exception:
        pass

    # Daily stats (steps, calories, intensity minutes)
    try:
        stats = client.get_stats(d)
        if stats and isinstance(stats, dict):
            result["steps"] = stats.get("totalSteps")
            result["active_calories"] = stats.get("activeKilocalories")
            result["total_calories"] = stats.get("totalKilocalories")
            result["floors"] = stats.get("floorsAscended")
            moderate = stats.get("moderateIntensityMinutes") or 0
            vigorous = stats.get("vigorousIntensityMinutes") or 0
            if moderate or vigorous:
                result["intensity_minutes"] = moderate + vigorous
    except Exception:
        pass

    # Resting heart rate
    try:
        hr = client.get_heart_rates(d)
        if hr and isinstance(hr, dict):
            rhr = hr.get("restingHeartRate")
            if rhr:
                result["resting_hr"] = int(rhr)
    except Exception:
        pass

    # Stress
    try:
        stress = client.get_stress_data(d)
        if stress and isinstance(stress, dict):
            avg = stress.get("avgStressLevel")
            mx = stress.get("maxStressLevel")
            if avg is not None:
                result["avg_stress"] = int(avg)
            if mx is not None:
                result["max_stress"] = int(mx)
    except Exception:
        pass

    # Training readiness
    try:
        readiness = client.get_training_readiness(d)
        if readiness:
            if isinstance(readiness, list) and readiness:
                readiness = readiness[0]
            if isinstance(readiness, dict):
                score = readiness.get("score")
                level = readiness.get("level") or readiness.get("feedback")
                if score is not None:
                    result["readiness_score"] = int(score)
                if level:
                    result["readiness_level"] = str(level)
    except Exception:
        pass

    print(json.dumps(result), flush=True)


def cmd_activities(n=5):
    """N most recent activities of any type."""
    client = get_client()
    try:
        activities = client.get_activities(0, n)
        print(json.dumps([_format_activity(a) for a in activities]), flush=True)
    except Exception as e:
        error(str(e))


def cmd_runs(n=5):
    """N most recent running workouts."""
    client = get_client()
    try:
        # Fetch extra to ensure we get N runs after filtering
        fetch_count = max(n * 4, 20)
        all_activities = client.get_activities(0, fetch_count)
        runs = [a for a in all_activities if _is_running(a)][:n]
        print(json.dumps([_format_activity(a) for a in runs]), flush=True)
    except Exception as e:
        error(str(e))


def cmd_training():
    """Training status, training load, and VO2 max."""
    client = get_client()
    d = today_str()
    result = {"date": d}

    # Training status
    try:
        ts = client.get_training_status(d)
        if ts:
            if isinstance(ts, list) and ts:
                ts = ts[0]
            if isinstance(ts, dict):
                status = (
                    ts.get("trainingStatusFeedback")
                    or ts.get("latestTrainingStatus")
                    or ts.get("trainingStatus")
                )
                load = ts.get("weeklyTrainingLoad") or ts.get("trainingLoad")
                feedback = ts.get("trainingLoadFeedback")
                if status:
                    result["training_status"] = str(status)
                if load is not None:
                    result["training_load"] = float(load)
                if feedback:
                    result["training_load_feedback"] = str(feedback)
    except Exception:
        pass

    # VO2 max and fitness age
    try:
        vo2 = client.get_max_metrics(d)
        if vo2:
            if isinstance(vo2, list) and vo2:
                vo2 = vo2[0]
            if isinstance(vo2, dict):
                generic = vo2.get("generic") or {}
                if isinstance(generic, dict):
                    vo2_val = generic.get("vo2MaxValue")
                    age = generic.get("fitnessAge")
                else:
                    vo2_val = vo2.get("vo2MaxValue")
                    age = None
                if vo2_val is not None:
                    result["vo2_max"] = float(vo2_val)
                if age is not None:
                    result["fitness_age"] = int(age)
    except Exception:
        pass

    # Training readiness
    try:
        readiness = client.get_training_readiness(d)
        if readiness:
            if isinstance(readiness, list) and readiness:
                readiness = readiness[0]
            if isinstance(readiness, dict):
                score = readiness.get("score")
                level = readiness.get("level") or readiness.get("feedback")
                if score is not None:
                    result["readiness_score"] = int(score)
                if level:
                    result["readiness_level"] = str(level)
    except Exception:
        pass

    print(json.dumps(result), flush=True)


# ---------------------------------------------------------------------------
# Activity formatting helpers
# ---------------------------------------------------------------------------

def _is_running(activity):
    atype = activity.get("activityType") or {}
    if isinstance(atype, dict):
        type_key = atype.get("typeKey", "").lower()
    else:
        type_key = str(atype).lower()
    return "running" in type_key or type_key in ("run", "trail_running", "treadmill_running")


def _format_activity(a):
    """Extract clean fields from a Garmin activity dict."""
    atype = a.get("activityType") or {}
    type_name = atype.get("typeKey", "unknown") if isinstance(atype, dict) else str(atype)

    duration_sec = float(a.get("duration") or 0)
    distance_m = float(a.get("distance") or 0)
    avg_speed_mps = float(a.get("averageSpeed") or 0)
    avg_hr = a.get("averageHR") or a.get("averageHeartRate")
    max_hr = a.get("maxHR") or a.get("maxHeartRate")
    calories = a.get("calories")
    elevation = a.get("elevationGain")

    # Pace: seconds per km (only meaningful for running/walking)
    avg_pace = None
    if distance_m > 0 and duration_sec > 0:
        avg_pace = duration_sec / (distance_m / 1000)

    # Start time: prefer local
    start_raw = a.get("startTimeLocal") or a.get("startTimeGMT") or ""
    start_date = start_raw[:10] if start_raw else None
    start_time = start_raw[:16] if start_raw else None

    return {
        "id": a.get("activityId"),
        "name": a.get("activityName"),
        "type": type_name,
        "date": start_date,
        "time": start_time,
        "duration_sec": int(duration_sec) if duration_sec else None,
        "distance_m": round(distance_m, 1) if distance_m else None,
        "avg_pace_sec_per_km": round(avg_pace, 1) if avg_pace else None,
        "avg_speed_mps": round(avg_speed_mps, 2) if avg_speed_mps else None,
        "avg_hr": int(avg_hr) if avg_hr else None,
        "max_hr": int(max_hr) if max_hr else None,
        "calories": int(calories) if calories else None,
        "elevation_gain_m": round(float(elevation), 1) if elevation else None,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]

    if not args:
        print("""Garmin Connect CLI

Commands:
  setup                  First-time interactive login (run once)
  summary [DATE]         Body Battery, steps, stress, resting HR
  activities [N]         N most recent activities (default: 5)
  runs [N]               N most recent running workouts (default: 5)
  training               Training status, load, VO2 max

DATE format: YYYY-MM-DD (defaults to today)""")
        sys.exit(0)

    cmd = args[0]

    if cmd == "setup":
        cmd_setup()
    elif cmd == "summary":
        cmd_summary(args[1] if len(args) > 1 else None)
    elif cmd == "activities":
        cmd_activities(int(args[1]) if len(args) > 1 else 5)
    elif cmd == "runs":
        cmd_runs(int(args[1]) if len(args) > 1 else 5)
    elif cmd == "training":
        cmd_training()
    else:
        error(f"Unknown command: {cmd}")
