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

// Helper to process a batch of movies with rate limiting
async function processBatch(batch, batchDelay = 1000) {
    const results = await Promise.all(
        batch.map(async (movie) => {
            if (!movie.tconst) {
                return movie;
            }
            
            const tmdbData = await fetchTMDBData(movie.tconst);
            
            if (tmdbData) {
                movie.productionCountries = tmdbData.productionCountries;
                movie.poster = tmdbData.poster;

                // Analyze title sentiment
                const titleResult = winkSentiment(movie["Title"]);
                if (titleResult.score > 0 && titleResult.score > maxScore) {
                    maxScore = titleResult.score;
                }
                if (titleResult.score < 0 && titleResult.score < minScore) {
                    minScore = titleResult.score;
                }

                const sentences = tmdbData.description
                    .split(/[.!?]+\s+/)
                    .filter(s => s.trim().length > 0)

                let descriptionSentiment = 0;
                
                // Analyze sentiment using wink-sentiment
                const analyzed = sentences.map(sentence => {
                    const result = winkSentiment(sentence)

                    if (result.score > 0 && result.score > maxScore) {
                        maxScore = result.score;
                    }
                    if (result.score < 0 && result.score < minScore) {
                        minScore = result.score;
                    }
                    descriptionSentiment += result.score;

                    const originalSentence = sentence.endsWith('.') || sentence.endsWith('!') || sentence.endsWith('?')
                        ? sentence
                        : sentence + '.';

                    return {
                        text: originalSentence,
                        score: result.score
                    }
                })

                // Calculate average description sentiment
                descriptionSentiment = sentences.length > 0 ? descriptionSentiment / sentences.length : 0;

                // Store both sentiments separately
                movie.titleSentiment = titleResult.score;
                movie.descriptionSentiment = descriptionSentiment;
                // Combined average for overall sentiment
                movie.sentiment = (titleResult.score + descriptionSentiment) / 2;
                movie.description = analyzed;
            }
            
            return movie;
        })
    );
    
    // Wait between batches to respect rate limits
    if (batchDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, batchDelay));
    }
    
    return results;
}

// Enrich raw movie array (before processing into cells)
export async function enrichMoviesArray(movies) {
    const BATCH_SIZE = 40; // TMDB allows 40 requests per second
    const BATCH_DELAY = 1000; // Wait 1 second between batches
    
    const batches = [];
    for (let i = 0; i < movies.length; i += BATCH_SIZE) {
        batches.push(movies.slice(i, i + BATCH_SIZE));
    }
    
    const enrichedMovies = [];
    for (let i = 0; i < batches.length; i++) {
        const batchResults = await processBatch(batches[i], BATCH_DELAY);
        enrichedMovies.push(...batchResults);
    }
    
    return { movies: enrichedMovies, minScore, maxScore };
}