"""
Mock tool functions for the Swarm plugin mode.
"""
import json


def get_weather(location: str, time: str = "now") -> str:
    """Get the current weather in a given location. Location MUST be a city."""
    return json.dumps({"location": location, "temperature": "65", "time": time})


def get_weather_forecast(location: str, days: str = "3") -> str:
    """Get a short weather forecast for a given location and number of days."""
    try:
        days_val = int(days)
    except Exception:
        days_val = 3
    return json.dumps(
        {"location": location, "days": days_val, "forecast": ["sunny", "cloudy", "rain"]}
    )


def get_air_quality(location: str) -> str:
    """Get a simple air quality report for a given location."""
    return json.dumps({"location": location, "aqi": 42, "status": "good"})


def send_email(recipient: str, subject: str, body: str) -> str:
    """Send a short email."""
    print("Sending email...")
    print(f"To: {recipient}")
    print(f"Subject: {subject}")
    print(f"Body: {body}")
    return "Sent!"


def send_sms(phone_number: str, message: str) -> str:
    """Send a short SMS message to a phone number."""
    print("Sending sms...")
    print(f"To: {phone_number}")
    print(f"Message: {message}")
    return "Sent!"


def get_top_rated_movies(limit: int = 10, min_imdb: float = 8.0) -> str:
    """Return a list of top-rated movies with IMDb scores."""
    return json.dumps(
        {
            "limit": limit,
            "min_imdb": min_imdb,
            "results": [
                {"title": "The Shawshank Redemption", "imdb": 9.3},
                {"title": "The Godfather", "imdb": 9.2},
                {"title": "The Dark Knight", "imdb": 9.0},
            ],
        }
    )


def search_movies_by_genre(genre: str, limit: int = 10) -> str:
    """Search movies by genre."""
    return json.dumps(
        {
            "genre": genre,
            "limit": limit,
            "results": ["Inception", "Interstellar", "The Matrix"],
        }
    )


def get_movie_summary(title: str) -> str:
    """Fetch a short summary for a movie title."""
    return json.dumps(
        {
            "title": title,
            "summary": "A brief synopsis for the requested movie.",
        }
    )


def search_web(query: str) -> str:
    """Search the web for general queries."""
    return json.dumps({"query": query, "results": []})


# Export all tools for easy import
MOCK_TOOLS = [
    get_weather,
    get_weather_forecast,
    get_air_quality,
    send_email,
    send_sms,
    get_top_rated_movies,
    search_movies_by_genre,
    get_movie_summary,
    search_web,
]
