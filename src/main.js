import * as d3 from "d3";
import moviesCSV from './data/NetflixAdded-merged.csv';
import { topWords, wordCategories } from './constants/words.js';
import { colors } from './constants/colors.js';
import { enrichMoviesArray } from './tmdb-api.js';

const posterUrl = 'https://image.tmdb.org/t/p/w1280/'

// set the dimensions and margins of the heatmap
const margin = {top: 50, right: 150, bottom: 30, left: 80},
  width = 750 - margin.left - margin.right,
  height = 1500 - margin.top - margin.bottom;

// color legend constants
const legendWidth = 350;
const legendHeight = 10;
const legendX = 0;
const legendY = 50;

let minViews, maxViews, minSentiment, maxSentiment;
let activeSelection = null;
let activeCategorySelection = null; // Track selected category
let openDescriptionId = null; // Track ID of the currently open description (only one at a time)
let currentMovies = []; // Store current movies being displayed
let currentTooltipMovieId = null; // Track which movie is currently displayed in tooltip
let movieShownInTooltip = null; // Store the movie object shown in tooltip
let totalMovieCount = 0; // Total number of unique movies in consideration
let processedData = null; // Store processed data globally for category aggregation
let displayedPosterMovies = []; // Track movie IDs whose posters are displayed, in order of priority

// column labels = runtimes (in minutes)
const runtimes = d3.range(20, 200, 10);

// Helper: Find which categories a word belongs to
const getCategoriesForWord = (word) => {
  return wordCategories.filter(cat => cat.words.includes(word));
};

// Declare variables that will be initialized after data loads
let svg, x, y, yAxisG;

// helper to update legend tick position
const updateLegendTick = (value) => {
  const legendTick = d3.select('.legend-tick');
  if (value === null || value === undefined) {
    legendTick.style("opacity", 0);
    return;
  }
  
  const scale = d3.scaleLinear()
    .domain([minViews, maxViews])
    .range([legendX, legendX + legendWidth]);
  
  const xPos = scale(value);
  legendTick
    .attr("transform", `translate(${xPos}, 0)`)
    .style("opacity", 1);
};

const setActiveSelection = (d) => {
  if (d === null) {
    activeSelection = null;
    svg.selectAll('.data-cell').classed('active', false);
    svg.selectAll('.data-cell').classed('inactive', false);
    resetHighlight();
    showSelectedMovies(null);
    updateLegendTick(null); // hide tick when clearing selection

    tooltip.style("visibility", "hidden");
    tooltip.style("opacity", 0);

    tooltip.html(''); // clear tooltip content
    currentTooltipMovieId = null; // reset tooltip tracking
    
    // Clear any posters when clearing selection
    d3.selectAll('.poster-overlay').remove();
    
    return;
  }

  // Clear any category selection when selecting a cell
  if (activeCategorySelection) {
    clearCategorySelection();
  }

  activeSelection = d;

  // Ensure posters are cleared (defensive, should already be cleared by clearCategorySelection)
  d3.selectAll('.poster-overlay').remove();

  // visually mark the selected data rect
  svg.selectAll('.data-cell').classed('active', cellD => cellD && cellD.word === d.word && cellD.length === d.length);
  svg.selectAll('.data-cell').classed('inactive', cellD => cellD && !(cellD.word === d.word && cellD.length === d.length));
  showSelectedMovies(d.word, d.movies, d.value, true); // Auto-open first description
  updateTooltip(); // Update tooltip when new cell is selected
  updateLegendTick(d.value); // show tick at cell's value position
}


// helper to highlight a y tick (word) and reset
const highlightTick = (word) => {
  // Don't highlight if there's an active selection
  if (activeSelection) return;
  
  yAxisG.selectAll('.tick')
    .filter(d => d === word)
    .select('text')
    .raise()
    .transition()
    .duration(100)
    .style('font-size', '16px')
    .style('font-weight', 'bold');
}

const resetHighlight = () => {
  yAxisG.selectAll('.tick')
  .filter(d => d !== activeSelection?.word)
    .select('text')
    .transition()
    .duration(100)
    .style('font-size', '12px')
    .style('font-weight', 'normal');
}

const getViewsInKOrM = (views) => {
  return views >= 1000000 ? `${(views / 1000000).toFixed(1)}m` : `${(views / 1000).toFixed(0)}k`;
};

// Helper: Extract English title (in case of multilingual titles)
const getEnglishTitle = (title) => {
  return title.split("//")[0];
};

function getSentimentValue(score) {
  let sentimentValue = 0;
  if (score > 0) {
    // positive side: map 0 → maxSentiment   to   0 → 1
    sentimentValue = score / maxSentiment;
  } 
  if (score < 0) {
    // negative side: map 0 → minSentiment   to   0 → -1
    sentimentValue = -(Math.abs(score) / Math.abs(minSentiment));
  }

  return Math.round(sentimentValue * 100);
}

// Helper to calculate average sentiment from an array of movies (using combined title + description)
const calculateAverageSentiment = (movies) => {
  if (!movies || movies.length === 0) return null;
  
  const moviesWithSentiment = movies.filter(m => m.sentiment !== undefined && m.sentiment !== null);
  if (moviesWithSentiment.length === 0) return null;
  
  const avgSentiment = d3.mean(moviesWithSentiment, m => m.sentiment);
  return { sentiment: avgSentiment };
};

// Update sentiment bar based on movie data
function updateSentimentBar(movieData, hasMovies = false) {
  const sentimentFill = d3.select('.sentiment-fill');
  const sentimentLabel = d3.select('#sentiment-label');
  
  if (!movieData || movieData.sentiment === undefined || movieData.sentiment === null) {
    // Reset bar visual
    sentimentFill
      .style('width', '0%')
      .style('left', '50%')
      .style('background-color', 'transparent');
    
    // Show "Not available" if movies exist but no sentiment data, otherwise clear
    if (hasMovies) {
      sentimentLabel.text('Sentiment: Neutral');
    } else {
      sentimentLabel.text('');
    }
    return;
  }

  const sentimentPercentage = getSentimentValue(movieData.sentiment);
  
  if (sentimentPercentage === 0) {
    // Neutral - no fill
    sentimentFill
      .style('width', '0%')
      .style('left', '50%')
      .style('background-color', 'transparent');
    sentimentLabel.text('Sentiment: Neutral');
  } else if (sentimentPercentage > 0) {
    // Positive - fill to the right
    sentimentFill
      .style('left', '50%')
      .style('width', `${sentimentPercentage / 2}%`) // divide by 2 because it's only half the bar
      .style('background-color', colors.sentimentPositive);
    sentimentLabel.text(`Sentiment: ${sentimentPercentage}% positive`);
  } else {
    // Negative - fill to the left
    const absPercentage = Math.abs(sentimentPercentage);
    sentimentFill
      .style('left', `${50 - (absPercentage / 2)}%`)
      .style('width', `${absPercentage / 2}%`)
      .style('background-color', colors.sentimentNegative);
    sentimentLabel.text(`Sentiment: ${absPercentage}% negative`);
  }
}

// Helper to convert normalized words back to plural form for highlighting
const unnormalizePlural = (word) => {
  if (word == 'man') {
    return 'men';
  }
  if (word == 'woman') {
    return 'women';
  }
  if (word == 'life') {
    return 'lives';
  }
  return word + 's';
};

const showSelectedMovies = (word, movies, hoverValue, autoOpenFirst = false, showToggleIcons = true, useTitleSentimentOnly = false, totalCount = null) => {
  const selectedMovieList = d3.select('.selected-movie-list');
  const movieCountElem = d3.select('#movie-count');
  
  // Clear and reset to empty state (only if no movies to show)
  if (!movies || movies.length === 0) {
    selectedMovieList.html('');
    // Recreate empty state element
    selectedMovieList.append('p')
      .attr('class', 'empty-state')
      .html('Hover over cells for more movie details');
    openDescriptionId = null;
    currentMovies = [];
    movieShownInTooltip = null;
    updateSentimentBar(null);
    // Clear movie count
    movieCountElem.html(`${totalMovieCount.toLocaleString()} movies`);
    movieCountElem.classed("movie-count-selected", false);
    return;
  }

  // Store current movies and reset open description
  currentMovies = movies;
  openDescriptionId = null;
  
  // Update movie count (use totalCount if provided, otherwise movies.length)
  const count = totalCount !== null ? totalCount : movies.length;
  movieCountElem.html(`${count} movie${count > 1 ? 's' : ''} <span>/ ${getViewsInKOrM(hoverValue)} average views</span>`);
  movieCountElem.classed("movie-count-selected", true);
  
  // Update sentiment bar - always show combined average sentiment (title + description)
  updateSentimentBar(calculateAverageSentiment(movies), true);
  
  // Determine which movie to show in tooltip (prefer first with poster)
  movieShownInTooltip = movies.find(m => m.poster) || movies[0];
  
  // Track first description for auto-open - use the same movie shown in tooltip
  if (autoOpenFirst && movieShownInTooltip && movieShownInTooltip.description && movieShownInTooltip.description.length > 0) {
    openDescriptionId = movieShownInTooltip.id;
  }

  // Clear existing content
  selectedMovieList.html('');

  // Add movie entries
  movies.forEach((d, index) => {
    const englishMovie = getEnglishTitle(d.title);
    const viewsInKOrM = getViewsInKOrM(d.views);
    
    // Bold the word(s) in the title if they exist
    let displayTitle = englishMovie;
    if (word) {
      // If word is an array, highlight all words
      const wordsToHighlight = Array.isArray(word) ? word : [word];
      
      wordsToHighlight.forEach(w => {
        const wordRegex = new RegExp(`\\b(${w})\\b`, 'gi');
        if (wordRegex.test(displayTitle)) {
          displayTitle = displayTitle.replace(wordRegex, '<strong>$1</strong>');
        } else {
          const unnormalizedWord = unnormalizePlural(w);
          const unnormalizedRegex = new RegExp(`\\b(${unnormalizedWord})\\b`, 'gi');
          displayTitle = displayTitle.replace(unnormalizedRegex, '<strong>$1</strong>');
        }
      });
    }
    
    const details = selectedMovieList.append('div')
      .attr('class', 'movie-details');

    const titleContainer = details.append('div')
      .attr('class', 'movie-title-container')

    const titleText = titleContainer.append('div')
      .attr('class', 'movie-title')
    
    titleText.append('h4')
      .html(displayTitle);
    
    titleText.append('span')
      .attr('class', 'views-text')
      .html(`${viewsInKOrM} views`);

    if (!!d.description.length) {
      let toggleIcon = null;
      
      // Only add toggle icon if showToggleIcons is true
      if (showToggleIcons) {
        toggleIcon = titleContainer.append('p')
          .attr('class', 'toggle-icon')
          .html('+');
      }

      const description = details.append('div')
        .attr('class', 'description');

      // Add individual movie sentiment bar
      if (d.sentiment !== undefined && d.sentiment !== null) {
        const sentimentPercentage = getSentimentValue(d.sentiment);
        const absPercentage = Math.abs(sentimentPercentage);
        const barWidth = (absPercentage / 100 * 350) / 2;
        
        const sentimentContainer = description.append('div')
          .attr('class', 'movie-sentiment-container');
        
        const sentimentBar = sentimentContainer.append('div')
          .attr('class', 'movie-sentiment-bar');
        
        if (sentimentPercentage === 0) {
          // Neutral - show thin divider line
          sentimentBar.append('div')
            .attr('class', 'movie-sentiment-divider')
            .style('width', '1px')
            .style('height', '12px')
            .style('background-color', '#6c6a4f');
        } else {
          const sentimentFill = sentimentBar.append('div')
            .attr('class', 'movie-sentiment-fill')
            .style('width', `${barWidth}px`)
            .style('background-color', sentimentPercentage > 0 ? colors.sentimentPositive : colors.sentimentNegative);
        }
        
        const sentimentText = sentimentContainer.append('span')
          .attr('class', 'movie-sentiment-text');
        
        if (sentimentPercentage === 0) {
          sentimentText.text('Neutral');
        } else if (sentimentPercentage > 0) {
          sentimentText.text(`${sentimentPercentage}% positive`);
        } else {
          sentimentText.text(`${absPercentage}% negative`);
        }
      }

      d.description.forEach(s => {
        description.append('p')
          .text(s.text)
          .style('color', !!s.score ? sentimentColorScale(s.score) : colors.sentimentNeutral);
      });
      
      // Auto-open description if this is the selected movie OR if shouldExpand is true (for category view)
      if ((autoOpenFirst && d.id === openDescriptionId) || d.shouldExpand) {
        description.classed('show', true);
        if (toggleIcon) toggleIcon.html('−');
        if (d.shouldExpand) {
          openDescriptionId = d.id; // Track as open
        }
      }

      // Only add click handler if toggle icons are shown (meaning this is an active selection)
      if (showToggleIcons) {
        titleContainer.on('click', () => {
          const isExpanding = !description.classed('show');
          
          // Different behavior for category selection vs cell selection
          if (activeCategorySelection) {
            // Category selection: allow multiple descriptions open
            if (isExpanding) {
              description.classed('show', true);
              if (toggleIcon) toggleIcon.html('−');
              openDescriptionId = d.id;
            } else {
              description.classed('show', false);
              if (toggleIcon) toggleIcon.html('+');
              // Don't clear openDescriptionId if other descriptions might be open
            }
            // Update poster collage
            updatePosterCollageForDescription(d, isExpanding);
          } else {
            // Cell selection: only one description open at a time
            if (isExpanding) {
              // Close all other descriptions
              d3.selectAll('.description').classed('show', false);
              d3.selectAll('.toggle-icon').html('+');
              
              // Open this description
              description.classed('show', true);
              if (toggleIcon) toggleIcon.html('−');
              openDescriptionId = d.id; // Set this as the open description
            } else {
              // Collapsing: just close this one
              description.classed('show', false);
              if (toggleIcon) toggleIcon.html('+');
              openDescriptionId = null;
            }
            // Update tooltip to show the currently opened description
            updateTooltip();
          }
        });
      }
    }
  });
}

// add word category labels and brackets on the right
// position these just outside the right edge of the heatmap
const categoryAxisOffset = width;
const categorySpacing = -5; // Increased spacing to accommodate text labels

// calculate levels for overlapping categories
const calculateCategoryLevels = (categories) => {
  const levels = [];
  
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    
    // find which words from this category exist in topWords
    const wordsInCategory = category.words.filter(word => topWords.includes(word));
    if (wordsInCategory.length === 0) continue;
    
    // get the y positions for these words
    const yPositions = wordsInCategory.map(word => y(word) + y.bandwidth() / 2);
    const minY = Math.min(...yPositions);
    const maxY = Math.max(...yPositions);
    
    // Add padding around category brackets for label space
    const padding = 30; // Space for multi-line labels
    const paddedMinY = minY - padding;
    const paddedMaxY = maxY + padding;
    
    // find the first level where this category doesn't overlap with others
    let level = 0;
    let foundLevel = false;
    
    while (!foundLevel) {
      // check if any existing category at this level overlaps
      let hasOverlap = false;
      
      for (let j = 0; j < levels.length; j++) {
        const existing = levels[j];
        
        // only check categories at the same level
        if (existing.level === level) {
          // Check for overlap with padding
          const rangesOverlap = !(paddedMaxY < existing.paddedMinY || paddedMinY > existing.paddedMaxY);
          
          if (rangesOverlap) {
            hasOverlap = true;
            break;
          }
        }
      }
      
      // if no overlap, we found our level
      if (!hasOverlap) {
        foundLevel = true;
      } else {
        level++;
      }
    }
    
    levels.push({ category, minY, maxY, paddedMinY, paddedMaxY, level });
  }
  
  return levels;
};

// build color scale for views
const colorScale = d3.scaleLinear()
  .range([colors.scaleLight, colors.scaleMid, colors.scaleDark])

// build color scale for sentiment
const sentimentColorScale = d3.scaleLinear()
  .range([colors.sentimentNegative, colors.sentimentNeutral, colors.sentimentPositive]);

// create tooltip
const tooltip = d3.select("body")
  .append("div")
  .attr("class", "tooltip");

// Helper to position tooltip smartly (above cursor if near bottom, to the right otherwise)
const positionTooltip = (event) => {
  const tooltipNode = tooltip.node();
  const tooltipHeight = tooltipNode ? tooltipNode.offsetHeight : 300; // estimate if not rendered yet
  const viewportHeight = window.innerHeight;
  const scrollY = window.scrollY || window.pageYOffset;
  const mouseY = event.pageY;
  
  // If tooltip would extend beyond viewport bottom, show it above the cursor
  if (mouseY + tooltipHeight + 20 > scrollY + viewportHeight) {
    tooltip.style("top", (mouseY - tooltipHeight - 10) + "px")
           .style("left", (event.pageX + 10) + "px");
  } else {
    tooltip.style("top", (mouseY - 10) + "px")
           .style("left", (event.pageX + 10) + "px");
  }
};

// Helper to update tooltip with movie poster
const updateTooltip = () => {
  let movieToShow = null;
  
  // If there's an open description, show that movie
  if (openDescriptionId) {
    movieToShow = currentMovies.find(m => m.id === openDescriptionId);
  } else if (movieShownInTooltip) {
    // Otherwise use the stored movie from showSelectedMovies
    movieToShow = movieShownInTooltip;
  }
  
  // Don't update if we're already showing this movie
  if (movieToShow && movieToShow.id === currentTooltipMovieId) {
    return;
  }
  
  // Update the current tooltip movie ID
  currentTooltipMovieId = movieToShow ? movieToShow.id : null;
  
  tooltip.html(''); // clear existing content
  
  if (movieToShow) {
    if (movieToShow.poster) {
      // Has poster - show with loading state
      const loadingDiv = tooltip.append("div").attr("class", "loading-tooltip");
      tooltip.style("visibility", "visible");
      tooltip.style("opacity", 1);
      tooltip.style("background-color", "white");
      
      const img = tooltip.append("img")
        .attr("src", `${posterUrl}${movieToShow.poster}`)
        .attr("alt", movieToShow.title)
        .style("opacity", 0); // Start hidden
      
      // Fade out loading and fade in image when loaded
      img.on('load', function() {
        loadingDiv.classed('hide-loading', true);
        d3.select(this).transition().duration(300).style("opacity", 1);
      });
      
      // Fallback in case image loads before event listener is attached
      if (img.node().complete) {
        loadingDiv.classed('hide-loading', true);
        img.style("opacity", 1);
      }
    } else {
      tooltip.style("visibility", "visible");
      tooltip.style("opacity", 0.2);
      tooltip.style("background-color", colors.scaleDark);
    }
  }
};

// Show loading indicator
d3.select('.selected-movie-list').html('<p class="empty-state">Loading data...</p>');

// normalize words to their singular form
const normalizePlural = (word) => {
  let normalizedWord = word;

  if (word == 'men') {
    normalizedWord = 'man';
  }

  if (word == 'women') {
    normalizedWord = 'woman';
  }

  if (word == 'lives') {
    normalizedWord = 'life';
  }
  
  if (word.endsWith('s') && word.length > 2 && !['christmas', 'its', 'lasts', 'miss'].includes(word)) {
    normalizedWord = word.slice(0, -1);
  }
  
  return normalizedWord;
};

// get movie length in mins
const getMovieLengthInMinutes = (runtime) => {
  const numbers = runtime.split(":");
  const hours = parseInt(numbers[0]);
  const minutes = parseInt(numbers[1]);
  const totalMinutes = (hours * 60) + minutes;
  return totalMinutes;
}

// Helper: Extract and clean words from a title
const extractWordsFromTitle = (title) => {
  const englishWords = (title || "").split("//")[0]; // in case of multiple languages, only take english translation
  return englishWords
    .split(" ")
    .map(w => w.toLowerCase().replace(/[^a-zA-Z]/g, ''))
    .filter(w => w.length > 0);
}

// Helper: Get normalized topWords from a title
const getTopWordsFromTitle = (title) => {
  const words = extractWordsFromTitle(title);
  
  // Only process movies with 5 or fewer words
  if (!words.length || words.length > 5) return [];

  // Return unique normalized words that are in topWords
  const normalizedWords = words
    .map(word => normalizePlural(word))
    .filter(normalized => topWords.includes(normalized));
  
  // Deduplicate - use Set to remove duplicate words
  return [...new Set(normalizedWords)];
}

// Filter movies that contain any topWords (before enrichment to save API calls)
const filterMoviesWithTopWords = (data) => {
  return data.filter(row => {
    return getTopWordsFromTitle(row["Title"]).length > 0;
  });
}

// process the data based on the titles, runtime, and views into tuples 
// (word in title, runtime in mins rounded to 10, views)
// Expects enriched movie data with TMDB fields already attached
const processData = (data) => {
  // flatten rows into individual (length, word, views, title) items for words in topWords
  const items = data.flatMap(row => {
    const topWordsInTitle = getTopWordsFromTitle(row["Title"]);

    // Skip if no topWords found (already filtered, but just in case)
    if (topWordsInTitle.length === 0) return [];

    const runtime = getMovieLengthInMinutes(row["Runtime"]);
    const roundedRuntime = Math.round(runtime / 10) * 10;
    // remove commas from the Views string before parsing
    const views = parseInt(row["Views"].replace(/,/g, ''));
    const title = row["Title"];
    const tconst = row["tconst"];
    
    // Keep TMDB data from enriched row
    const productionCountries = row.productionCountries || [];
    const description = row.description || '';
    const poster = row.poster || '';
    const sentiment = row.sentiment;
    const titleSentiment = row.titleSentiment;
    const descriptionSentiment = row.descriptionSentiment;

    // Create an item for each topWord found in the title
    return topWordsInTitle.map(normalized => {
      const categories = getCategoriesForWord(normalized);
      return { 
        length: roundedRuntime, 
        word: normalized, 
        views, 
        title, 
        runtime, 
        tconst,
        productionCountries,
        description,
        poster,
        sentiment,
        titleSentiment,
        descriptionSentiment,
        categories: categories.map(c => c.name) // Store category names
      };
    });
  });

  // roll up by length and word to get average of views 
  // keep individual movie details with TMDB data
  const rolled = d3.rollup(
    items,
    v => {
      // Deduplicate movies by title (case-insensitive, trimmed)
      const uniqueMovies = Array.from(
        new Map(v.map(d => [d.title.trim().toLowerCase(), d])).values()
      );
      
      return {
        value: Math.round(d3.mean(uniqueMovies, d => d.views)),
        movies: uniqueMovies.map(d => ({ 
          title: d.title, 
          views: d.views, 
          runtime: d.runtime, 
          id: d.tconst,
          productionCountries: d.productionCountries,
          description: d.description,
          poster: d.poster,
          sentiment: d.sentiment,
          titleSentiment: d.titleSentiment,
          descriptionSentiment: d.descriptionSentiment,
          categories: d.categories,
          word: d.word // Keep track of which word this movie came from
        }))
      };
    },
    d => d.length,
    d => d.word
  );

  // convert the nested rollup into the expected array of objects
  const result = Array.from(rolled, ([length, varMap]) => {
    return Array.from(varMap, ([word, aggregated]) => ({
      length,
      word,
      value: aggregated.value,
      movies: aggregated.movies
    }));
  }).flat();
  
  return result;
}

// Aggregate movies from all cells that contain words in a specific category
const aggregateMoviesByCategory = (category) => {
  if (!processedData) return { movies: [], cells: [] };
  
  // Find all cells that contain words from this category
  const cellsInCategory = processedData.filter(cell => 
    category.words.includes(cell.word)
  );
  
  // Collect all unique movies across these cells
  // Deduplicate by title
  const movieMap = new Map();
  cellsInCategory.forEach(cell => {
    cell.movies.forEach(movie => {
      const key = movie.title.trim().toLowerCase();
      if (!movieMap.has(key)) {
        movieMap.set(key, movie);
      }
    });
  });
  
  const allMovies = Array.from(movieMap.values());
  
  // Sort by priority
  sortMoviesByPriority(allMovies);
  
  return {
    movies: allMovies,
    cells: cellsInCategory,
    avgViews: allMovies.length > 0 ? Math.round(d3.mean(allMovies, m => m.views)) : 0
  };
};

// Handle category click
const handleCategoryClick = (category) => {
  // Toggle: if same category clicked, deselect
  if (activeCategorySelection && activeCategorySelection.name === category.name) {
    clearCategorySelection();
    return;
  }
  
  // Clear any active cell selection
  if (activeSelection) {
    setActiveSelection(null);
  }
  
  // Set new category selection
  activeCategorySelection = category;
  
  // Update visual state of category labels
  svg.selectAll('.category-label').classed('category-selected', false);
  svg.selectAll('.category-label')
    .filter(function() { return d3.select(this).attr('data-category') === category.name; })
    .classed('category-selected', true);
  
  // Get aggregated data first
  const { movies, cells, avgViews } = aggregateMoviesByCategory(category);
  
  // Initialize displayedPosterMovies with movies that have posters
  displayedPosterMovies = cells
    .map(cell => cell.movies.find(m => m.poster)?.id)
    .filter(Boolean);
  
  // Sort movies by priority
  sortMoviesByPriority(movies);
  
  // Mark movies that should be expanded based on displayedPosterMovies
  movies.forEach(movie => {
    movie.shouldExpand = displayedPosterMovies.includes(movie.id);
  });
  
  // Mark cells as active/inactive based on category
  svg.selectAll('.data-cell').classed('inactive', function(cellD) {
    if (!cellD) return false;
    // Cell is inactive if its word is not in the selected category
    return !category.words.includes(cellD.word);
  });
  
  showSelectedMovies(
    category.words, // Pass all words in category for highlighting
    movies,
    avgViews,
    false, // Don't auto-open first
    true, // Show toggle icons
    false, // Use combined sentiment
    movies.length // Total count
  );
  
  // Show poster collage on heatmap
  showPosterCollage(cells);
  
  // Update legend tick
  updateLegendTick(avgViews);
  
  // Update tooltip to hide
  tooltip.style("visibility", "hidden").style("opacity", 0);
};

// Clear category selection
const clearCategorySelection = () => {
  activeCategorySelection = null;
  displayedPosterMovies = []; // Reset displayed poster movies
  
  // Clean up shouldExpand property from all movies in processedData
  if (processedData) {
    processedData.forEach(cell => {
      cell.movies.forEach(movie => {
        delete movie.shouldExpand;
      });
    });
  }
  
  svg.selectAll('.category-label').classed('category-selected', false);
  svg.selectAll('.data-cell').classed('inactive', false); // Clear inactive styling
  d3.selectAll('.poster-overlay').remove(); // Clear poster collage
  showSelectedMovies(null);
  updateLegendTick(null);
};

// Show poster collage as tooltip-style overlays
const showPosterCollage = (cells) => {
  // Clear any existing poster overlays
  d3.selectAll('.poster-overlay').remove();
  
  // Deduplicate cells by movie ID - keep the first cell for each unique movie
  const seenMovieIds = new Set();
  const uniqueCells = [];
  
  cells.forEach(cell => {
    const movieWithPoster = cell.movies.find(m => m.poster);
    if (movieWithPoster && !seenMovieIds.has(movieWithPoster.id)) {
      seenMovieIds.add(movieWithPoster.id);
      uniqueCells.push({ cell, movie: movieWithPoster });
    }
  });
  
  // Sort by priority (higher priority = drawn last = appears on top)
  uniqueCells.sort((a, b) => {
    const aPriority = displayedPosterMovies.indexOf(a.movie.id);
    const bPriority = displayedPosterMovies.indexOf(b.movie.id);
    return (bPriority === -1 ? Infinity : bPriority) - (aPriority === -1 ? Infinity : aPriority);
  });
  
  // Create poster overlays
  uniqueCells.forEach(({ cell, movie }, index) => {
    const priority = displayedPosterMovies.indexOf(movie.id);
    const zIndex = priority !== -1 ? 100 + (displayedPosterMovies.length - priority) : 50 + index;
    createPosterOverlay(cell, movie, zIndex, true);
  });
};

// Helper: Sort movies by displayedPosterMovies priority, then by views
const sortMoviesByPriority = (movies) => {
  return movies.sort((a, b) => {
    const aIndex = displayedPosterMovies.indexOf(a.id);
    const bIndex = displayedPosterMovies.indexOf(b.id);
    
    const aIsDisplayed = aIndex !== -1;
    const bIsDisplayed = bIndex !== -1;
    
    if (aIsDisplayed && !bIsDisplayed) return -1;
    if (!aIsDisplayed && bIsDisplayed) return 1;
    if (aIsDisplayed && bIsDisplayed) return aIndex - bIndex;
    
    return b.views - a.views;
  });
};

// Helper: Create a single poster overlay element
const createPosterOverlay = (cell, movie, zIndex, keepFrontOnClick = true) => {
  const posterWidth = 200 / 2;
  const posterHeight = 300 / 2;
  
  // Get cell center position
  const cellX = x(cell.length) + x.bandwidth() / 2;
  const cellY = y(cell.word) + y.bandwidth() / 2;
  
  // Convert to page coordinates
  const svgElement = svg.node();
  const svgRect = svgElement.getBoundingClientRect();
  const pageX = svgRect.left + cellX + margin.left;
  const pageY = svgRect.top + cellY + margin.top + window.scrollY;
  
  // Create poster overlay
  const posterOverlay = d3.select('body')
    .append('div')
    .attr('class', 'poster-overlay')
    .attr('data-cell-id', `${cell.length}-${cell.word}`)
    .attr('data-movie-id', movie.id)
    .style('left', `${pageX - posterWidth / 2}px`)
    .style('top', `${pageY - posterHeight / 2}px`)
    .style('width', `${posterWidth}px`)
    .style('height', `${posterHeight}px`)
    .style('z-index', zIndex);
  
  // Add poster image
  posterOverlay.append('img')
    .attr('src', `${posterUrl}${movie.poster}`)
    .attr('alt', movie.title);
  
  // Track if clicked (to keep at front)
  let isClicked = false;
  
  // Hover to bring to front
  posterOverlay.on('mouseenter', function() {
    d3.select(this)
      .classed('hover-front', true)
      .style('z-index', 1000);
  });
  
  posterOverlay.on('mouseleave', function() {
    if (!isClicked || !keepFrontOnClick) {
      d3.select(this)
        .classed('hover-front', false)
        .style('z-index', zIndex);
    }
  });
  
  // Click handler
  posterOverlay.on('click', function(event) {
    event.stopPropagation();
    if (keepFrontOnClick) {
      isClicked = true;
      d3.select(this).style('z-index', 1000);
    }
    scrollToMovieInAside(movie.id);
  });
  
  return posterOverlay;
};

// Update poster collage when description is opened/closed in category view
const updatePosterCollageForDescription = (movie, isExpanding) => {
  if (!activeCategorySelection || !processedData) return;
  
  // Find the cell that contains this movie's word
  const cell = processedData.find(c => 
    c.word === movie.word && 
    c.movies.some(m => m.id === movie.id)
  );
  
  if (!cell) return;
  
  if (isExpanding) {
    // Add movie to displayedPosterMovies if not already there
    if (!displayedPosterMovies.includes(movie.id)) {
      displayedPosterMovies.push(movie.id);
    }
    
    // Remove any existing poster for this cell, then create new one
    d3.selectAll('.poster-overlay')
      .filter(function() {
        return d3.select(this).attr('data-cell-id') === `${cell.length}-${cell.word}`;
      })
      .remove();
    
    if (movie.poster) {
      createPosterOverlay(cell, movie, 200, false);
    }
  } else {
    // Remove movie from displayedPosterMovies
    const index = displayedPosterMovies.indexOf(movie.id);
    if (index !== -1) {
      displayedPosterMovies.splice(index, 1);
    }
    
    // Remove the poster for this movie
    d3.selectAll('.poster-overlay')
      .filter(function() {
        return d3.select(this).attr('data-movie-id') === movie.id;
      })
      .remove();
  }
};

// Function to scroll to a specific movie in the aside
const scrollToMovieInAside = (movieId) => {
  if (!movieId || !activeCategorySelection) return;
  
  // Check if movie is already at the top
  const existingIndex = displayedPosterMovies.indexOf(movieId);
  if (existingIndex === 0) {
    // Already at the top, no need to re-render
    return;
  }
  
  // Remove from current position if it exists
  if (existingIndex !== -1) {
    displayedPosterMovies.splice(existingIndex, 1);
  }
  // Add to the top
  displayedPosterMovies.unshift(movieId);
  
  // Re-aggregate and re-render with new sort order
  const { movies, cells, avgViews } = aggregateMoviesByCategory(activeCategorySelection);
  
  // Mark movies that should be expanded based on displayedPosterMovies
  movies.forEach(movie => {
    movie.shouldExpand = displayedPosterMovies.includes(movie.id);
  });
  
  showSelectedMovies(
    activeCategorySelection.words,
    movies,
    avgViews,
    false,
    true,
    false,
    movies.length
  );
};

const loadData = async () => {
  const data = await moviesCSV;

  // Step 1: Filter movies that contain topWords (before enrichment)
  const filteredMovies = filterMoviesWithTopWords(data);

  // Step 2: Deduplicate movies by title to reduce API calls
  const uniqueMovies = Array.from(
    new Map(filteredMovies.map(row => [row["Title"].trim().toLowerCase(), row])).values()
  );

  totalMovieCount = uniqueMovies.length;

  const movieCountElem = d3.select('#movie-count');
  movieCountElem.html(`${totalMovieCount.toLocaleString()} movies`);
  movieCountElem.style.fontWeight = 'normal';

  // Step 3: Enrich unique movies with TMDB data
  d3.select('.selected-movie-list').html('<p class="empty-state"><span>Fetching TMDB data...</span></p>');
  const { movies, minScore, maxScore } = await enrichMoviesArray(uniqueMovies);
  minSentiment = minScore;
  maxSentiment = maxScore;

  const midScore = (minScore + maxScore) / 2;
  sentimentColorScale.domain([minScore, midScore, maxScore]);

  d3.select('.selected-movie-list').html('<p class="empty-state">Hover over cells for more movie details</p>');

  // Step 4: Process enriched data into cells
  processedData = processData(movies); // Store globally for category aggregation

  // Step 5: Create SVG and scales (after data is ready)
  svg = d3.select("#heatmap")
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

  // x scale
  x = d3.scaleBand()
    .range([0, width])
    .domain(runtimes)
    .padding(0.01);

  // add x-axis labels
  svg.append("g")
    .call(d3.axisTop(x).tickValues(runtimes.filter(d => d % 20 === 0)).tickSize(0))
    .call(g => g.select(".domain").remove());

  // add centered x-axis label
  svg.append("text")
    .attr("class", "x-axis-label")
    .attr("x", width / 2)
    .attr("y", -25)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .text("Runtime (mins)");

  // y scale
  y = d3.scaleBand()
    .range([0, height])
    .domain(topWords)
    .padding(0.01);

  // add y-axis labels on the left
  yAxisG = svg.append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(-5, 0)`)
    .call(d3.axisLeft(y).tickSize(0))
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll('.tick text').style('font-size', '12px').style('font-weight', 'normal'));

  // Add word category labels and brackets on the right
  const categoryLevels = calculateCategoryLevels(wordCategories);

  categoryLevels.forEach(({ category, minY, maxY, level }) => {
    const centerY = (minY + maxY) / 2;
    // push each overlapping level further to the right
    const xOffset = categoryAxisOffset + (level * categorySpacing);
    
    // draw bracket
    const bracketWidth = 12.5;
    // bracket opens to the right, starting at the heatmap edge and extending outward
    svg.append("path")
      .attr("d", `M ${xOffset} ${minY} 
                  L ${xOffset + bracketWidth} ${minY} 
                  L ${xOffset + bracketWidth} ${maxY} 
                  L ${xOffset} ${maxY}`)
      .attr("stroke", colors.dark)
      .attr("opacity", 0.33)
      .attr("stroke-width", 1)
      .attr("fill", "none");
    
    // add category label
    const text = svg.append("text")
      .attr("class", "category-label")
      .attr("data-category", category.name)
      .attr("x", xOffset + bracketWidth + 5)
      .attr("y", centerY)
      .attr("text-anchor", "start")
      .style("font-size", "14px")
      .style("font-weight", "bold")
      .style("cursor", "pointer")
      .on("click", function() {
        handleCategoryClick(category);
      });
    
    // check if category name contains & or multiple words
    if (category.name.includes('&') || category.name.includes(' ')) {
      const parts = category.name.split('&');

      let wordParts;
      if (parts.length == 1) {
        wordParts = parts[0].split(' ');
      } else {
        wordParts = [`${parts[0].trim()} &`, parts[1].trim()];
      }

      text.append("tspan")
        .attr("x", xOffset + bracketWidth + 10)
        .attr("dy", "-0.5em")
        .text(wordParts[0]);
      
      text.append("tspan")
        .attr("x", xOffset + bracketWidth + 10)
        .attr("dy", "1.1em")
        .text(wordParts[1]);
    } else {
      text.text(category.name);
    }
  });

  // update color scale domain based on actual data
  minViews = d3.min(processedData, d => d.value);
  maxViews = d3.max(processedData, d => d.value);
  const midViews = (minViews + maxViews) / 2;
  colorScale.domain([minViews, midViews, maxViews]);

  const legend = d3.select('#legend').append("svg");

  legend.attr("width", legendWidth)
    .attr("height", legendHeight + 75);

  // create gradient for legend
  const defs = legend.append("defs");
  const linearGradient = defs.append("linearGradient")
    .attr("id", "legend-gradient");

  linearGradient.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", colorScale(minViews));

  linearGradient.append("stop")
    .attr("offset", "50%")
    .attr("stop-color", colorScale(midViews));

  linearGradient.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", colorScale(maxViews));

  // draw legend rectangle
  legend.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("fill", "url(#legend-gradient)");

  // min label
  legend.append("text")
    .attr("x", legendX + legendWidth / 2)
    .attr("y", legendY - 25)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .text("Views");

  // min label
  legend.append("text")
    .attr("x", legendX)
    .attr("y", legendY + legendHeight + 15)
    .attr("text-anchor", "start")
    .style("font-size", "12px")
    .text(minViews.toLocaleString());

  // max label
  legend.append("text")
    .attr("x", legendWidth)
    .attr("y", legendY + legendHeight + 15)
    .attr("text-anchor", "end")
    .style("font-size", "12px")
    .text(maxViews.toLocaleString());

  // add tick indicator (initially hidden)
  const legendTick = legend.append("g")
    .attr("class", "legend-tick")
    .style("opacity", 0);

  legendTick.append("line")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", legendY - 3)
    .attr("y2", legendY + legendHeight + 3)
    .attr("stroke", colors.dark)
    .attr("stroke-width", 1);

  // helper to filter cells based on value range and show matching movies
  const filterCellsByValue = (hoverValue, tolerance = (maxViews - minViews) * 0.05) => {
    if (hoverValue === null) {
      svg.selectAll('.data-cell').classed('inactive', false).classed('legend-active', false);
      showSelectedMovies(null);
      return;
    }

    // collect all movies from highlighted cells and track unique words
    const matchingMovies = [];
    const matchingWords = new Set();
    
    svg.selectAll('.data-cell').each(function(d) {
      if (!d) return;
      const isInRange = Math.abs(d.value - hoverValue) <= tolerance;
      d3.select(this)
        .classed('legend-active', isInRange)
        .classed('inactive', !isInRange);
      
      // collect ALL movies from highlighted cells (not filtered by individual movie.views)
      if (isInRange && d.movies) {
        matchingWords.add(d.word); // track unique words from highlighted cells
        d.movies.forEach(movie => {
          matchingMovies.push({ ...movie, word: d.word });
        });
      }
    });

    // show the filtered movies
    if (matchingMovies.length > 0) {
      // sort by distance from hovered value (closest first), then by views descending
      matchingMovies.sort((a, b) => {
        const distA = Math.abs(a.views - hoverValue);
        const distB = Math.abs(b.views - hoverValue);
        if (distA !== distB) return distA - distB;
        return b.views - a.views;
      });
      
      // dedupe by title
      const uniqueMovies = Array.from(
        new Map(matchingMovies.map(m => [m.title.trim().toLowerCase(), m])).values()
      );
      
      const filteredMoviesCount = uniqueMovies.length;
      
      // Limit to first 20 movies for display performance during legend hover
      const moviesToShow = uniqueMovies.slice(0, 20);
      
      // Pass all matching words as an array to highlight them in titles
      // Pass filteredMoviesCount so count shows correct data, but only render 20 movies
      const wordsArray = Array.from(matchingWords);
      showSelectedMovies(wordsArray, moviesToShow, hoverValue, false, false, true, filteredMoviesCount); // No toggle icons on legend hover
      // Don't update tooltip when hovering legend - tooltip should only show for cell hovers and description clicks
    } else {
      showSelectedMovies(null);
    }
  };

  // add interactive overlay to legend for hover detection
  legend.append("rect")
    .attr("x", legendX)
    .attr("y", legendY - 10)
    .attr("width", legendWidth)
    .attr("height", legendHeight + 20)
    .style("fill", "transparent")
    .style("cursor", "crosshair")
    .on('mousemove', function(event) {
      // Block legend hover when category is selected
      if (activeCategorySelection) return;
      if (activeSelection) return; // don't interfere with active selection
      
      const [mouseX] = d3.pointer(event, legend.node());
      
      // clamp to legend bounds
      if (mouseX < legendX || mouseX > legendX + legendWidth) return;
      
      const scale = d3.scaleLinear()
        .domain([legendX, legendX + legendWidth])
        .range([minViews, maxViews]);
      
      const hoverValue = scale(mouseX);
      updateLegendTick(hoverValue);
      filterCellsByValue(hoverValue);
    })
    .on('mouseout', function() {
      // Block legend hover exit when category is selected
      if (activeCategorySelection) return;
      if (activeSelection) return;
      
      updateLegendTick(null);
      filterCellsByValue(null);
    });

  // create grid background - all possible cells
  svg.selectAll(".grid-cell")
      .data(runtimes.flatMap(length => topWords.map(word => ({ length, word }))))
      .enter()
      .append("rect")
      .attr("class", "grid-cell")
      .attr("x", function(d) { return x(d.length) })
      .attr("y", function(d) { return y(d.word) })
      .attr("width", x.bandwidth() )
      .attr("height", y.bandwidth() )
      .style("fill", "white")
      .style("stroke", colors.dark)
      .style("stroke-width", 0.1);
  
    // highlight corresponding y label when hovering a grid row
    svg.selectAll('.grid-cell')
      .on('mouseover', function(event, d) {
        // Block grid hover when category is selected
        if (activeCategorySelection) return;
        highlightTick(d.word);
      })
      .on('mouseout', function() {
        // Block grid hover exit when category is selected
        if (activeCategorySelection) return;
        resetHighlight();
      })
      .on('click', function(event, d) {
        // Clear category selection if active
        if (activeCategorySelection) {
          clearCategorySelection();
        }
        setActiveSelection(null);
        resetHighlight();
      });

  // add data rectangles on top
  svg.selectAll(".data-cell")
      .data(processedData, function(d) {return d.length+':'+d.word;})
      .enter()
      .append("rect")
      .attr("class", "data-cell")
      .attr("x", function(d) { return x(d.length) })
      .attr("y", function(d) { return y(d.word) })
      .attr("width", x.bandwidth() )
      .attr("height", y.bandwidth() )
      .style("fill", function(d) { return colorScale(d.value)} )
      .on("mouseover", function(event, d) {
        // Block all hover interactions when category is selected
        if (activeCategorySelection) return;
        
        if (!activeSelection) {
          highlightTick(d.word);

          // Clean movies to remove shouldExpand property (so hover never shows expanded descriptions)
          const cleanMovies = d.movies.map(m => ({ ...m, shouldExpand: false }));
          showSelectedMovies(d.word, cleanMovies, d.value, false, true, true); // Show toggle icons on cell hover
          updateTooltip(); // Update tooltip based on currentMovies/openDescriptions
          updateLegendTick(d.value); // show tick on hover
          svg.selectAll('.data-cell').classed('inactive', false).classed('legend-active', false); // clear filtering
        }
        // When there's an active selection, tooltip stays locked - do nothing on hover
      })
      .on("mousemove", function(event, d) {
        // Block tooltip movement when category is selected
        if (activeCategorySelection) return;
        
        // Only allow tooltip to move if there's no active selection
        if (!activeSelection) {
          positionTooltip(event);
        }
        // When there's an active selection, tooltip stays locked at its position
      })
      .on("mouseout", function() {
        // Block hover exit when category is selected
        if (activeCategorySelection) return;
        
        resetHighlight();

        if (!activeSelection) {
          showSelectedMovies(null);
          updateLegendTick(null); // hide tick on mouseout if no active selection
          svg.selectAll('.data-cell').classed('inactive', false).classed('legend-active', false); // clear classes

          tooltip.style("visibility", "hidden");
          tooltip.style("opacity", 0);

          tooltip.html(''); // clear tooltip content
          currentTooltipMovieId = null; // reset tooltip tracking
        }
      })
      .on('click', function(event, d) {
        // prevent document click listener from clearing immediately
        event.stopPropagation();
        // toggle selection: clicking same cell clears, otherwise set
        if (activeSelection && activeSelection.word === d.word && activeSelection.length === d.length) {
          setActiveSelection(null);
        } else {
          setActiveSelection(d);
          // Position tooltip at the clicked cell location (smart positioning)
          positionTooltip(event);
        }
      })
} 

// Add document-level click handler to clear selection when clicking outside
document.addEventListener('click', (event) => {
  const clickedOnHeatmap = event.target.closest('#heatmap');
  const clickedOnAside = event.target.closest('.aside');
  const clickedOnPosterOverlay = event.target.closest('.poster-overlay');
  
  if (!clickedOnHeatmap && !clickedOnAside && !clickedOnPosterOverlay) {
    // Clear cell selection if active
    if (activeSelection) {
      setActiveSelection(null);
    }
    // Clear category selection if active
    if (activeCategorySelection) {
      clearCategorySelection();
    }
  }
});

// Loading screen functionality
const loadingScreen = document.getElementById('loading-screen');
const exploreBtn = document.getElementById('explore-btn');

// Load data in background
loadData().then(() => {
  // Show button when data is ready
  exploreBtn.innerHTML = 'Explore'
  exploreBtn.disabled = false;
});

// Handle explore button click
exploreBtn.addEventListener('click', () => {
  loadingScreen.classList.add('hidden');
  // Remove from DOM after transition completes
  setTimeout(() => {
    loadingScreen.style.display = 'none';
  }, 500);
});