import winkSentiment from 'wink-sentiment'

// Simple TMDB API fetcher
const TMDB_TOKEN = import.meta.env.VITE_TMDB_API_KEY;

const tmdbCache = new Map();

export async function fetchTMDBData(imdbId) {
    if (tmdbCache.has(imdbId)) {
        return tmdbCache.get(imdbId);
    }


    const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id`;
    const options = {
        method: 'GET',
        headers: {
            accept: 'application/json',
            Authorization: `Bearer ${TMDB_TOKEN}`
        }
    };
    
    try {
        const findResponse = await fetch(findUrl, options);
        const findData = await findResponse.json();
        
        const results = findData.movie_results?.length > 0 
            ? findData.movie_results 
            : findData.tv_results;
        
        if (!results || results.length === 0) {
            tmdbCache.set(imdbId, null);
            return null;
        }
        
        const tmdbId = results[0].id;
        const mediaType = findData.movie_results?.length > 0 ? 'movie' : 'tv';
        
        const detailsUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}`;
        const detailsResponse = await fetch(detailsUrl, options);
        const details = await detailsResponse.json();
        
        const data = {
            productionCountries: details.production_countries || [],
            poster: details.poster_path || '',
            description: details.overview || ''
        };
        
        tmdbCache.set(imdbId, data);
        return data;
    } catch (error) {
        console.error(`Error fetching ${imdbId}:`, error);
        tmdbCache.set(imdbId, null);
        return null;
    }
}

let maxScore = 0;
let minScore = 0;

// Enrich raw movie array (before processing into cells)
export async function enrichMoviesArray(movies) {
    for (let i = 0; i < movies.length; i++) {
        const movie = movies[i];
        
        if (!movie.tconst) {
            continue;
        }
        
        const tmdbData = await fetchTMDBData(movie.tconst);
        
        if (tmdbData) {
            movie.productionCountries = tmdbData.productionCountries;
            movie.poster = tmdbData.poster;

            const sentences = tmdbData.description
                .split(/[.!?]+\s+/)
                .filter(s => s.trim().length > 0)

            let avgSentiment = 0;
            // Analyze sentiment using wink-sentiment
            const analyzed = sentences.map(sentence => {
                const result = winkSentiment(sentence)

                if (result.score > 0 && result.score > maxScore) {
                    maxScore = result.score;
                }
                if (result.score < 0 && result.score < minScore) {
                    minScore = result.score;
                }
                avgSentiment += result.score;

                const originalSentence = sentence.endsWith('.') || sentence.endsWith('!') || sentence.endsWith('?')
                    ? sentence
                    : sentence + '.';

                return {
                    text: originalSentence,
                    score: result.score
                }
            })

            // Calculate average sentiment
            avgSentiment /= sentences.length;

            movie.sentiment = avgSentiment;
            movie.description = analyzed;
        }
        
        // Rate limit: 40 req/sec
        await new Promise(resolve => setTimeout(resolve, 25));
    }

    return { movies, minScore, maxScore };
}