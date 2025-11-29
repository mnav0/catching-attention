import * as d3 from "d3";
import moviesCSV from './data/NetflixMovies_added.csv';
import { topWords, wordCategories } from './constants/words.js';
import { colors } from './constants/colors.js';
import { enrichMoviesArray } from './tmdb-api.js';

const posterUrl = 'https://image.tmdb.org/t/p/w1280/'

// set the dimensions and margins of the heatmap
const margin = {top: 50, right: 150, bottom: 250, left: 80},
  width = 750 - margin.left - margin.right,
  height = 1700 - margin.top - margin.bottom;

// color legend constants
const legendWidth = 350;
const legendHeight = 10;
const legendX = 0;
const legendY = 50;

let minViews, maxViews;
let activeSelection = null;

// column labels = runtimes (in minutes)
const runtimes = d3.range(20, 200, 10);

// Declare variables that will be initialized after data loads
let svg, x, y, yAxisG;

// helper to update legend tick position
const updateLegendTick = (value) => {
  const legendTick = d3.select('.legend-tick');
  if (value === null || value === undefined) {
    legendTick.transition().duration(200).style("opacity", 0);
    return;
  }
  
  const scale = d3.scaleLinear()
    .domain([minViews, maxViews])
    .range([legendX, legendX + legendWidth]);
  
  const xPos = scale(value);
  legendTick
    .attr("transform", `translate(${xPos}, 0)`)
    .transition()
    .duration(200)
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
    return;
  }

  activeSelection = d;

  // visually mark the selected data rect
  svg.selectAll('.data-cell').classed('active', cellD => cellD && cellD.word === d.word && cellD.length === d.length);
  svg.selectAll('.data-cell').classed('inactive', cellD => cellD && !(cellD.word === d.word && cellD.length === d.length));
  const selectedMovieList = d3.select('.selected-movie-list');
  const emptyState = selectedMovieList.select('.empty-state');
  selectedMovieList.html('');
  selectedMovieList.append(() => emptyState.node());
  emptyState.html('Titles');
  showSelectedMovies(d.word, d.movies, d.value);
  updateLegendTick(d.value); // show tick at cell's value position
}


// helper to highlight a y tick (word) and reset
const highlightTick = (word) => {
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

const showSelectedMovies = (word, movies, hoverValue) => {
  const selectedMovieList = d3.select('.selected-movie-list');
  const emptyState = selectedMovieList.select('.empty-state');
  
  // Clear and reset to empty state (only if no movies to show)
  if (!movies || movies.length === 0) {
    selectedMovieList.html('');
    emptyState.html('Hover over cells for more movie details');
    selectedMovieList.append(() => emptyState.node());
    return;
  }

  // Clear existing content
  selectedMovieList.html('');
  
  // Add header with count and views
  selectedMovieList.append('p')
    .attr('class', 'empty-state')
    .html(`${movies.length} title${movies.length > 1 ? 's' : ''} | <span>${getViewsInKOrM(hoverValue)} views</span>`);

  // Add movie entries
  movies.forEach(d => {
    const englishMovie = getEnglishTitle(d.title);
    const viewsInKOrM = getViewsInKOrM(d.views);
    
    // Bold the word in the title if it exists
    let displayTitle = englishMovie;
    if (word) {
      const wordRegex = new RegExp(`\\b(${word})\\b`, 'i');
      if (wordRegex.test(englishMovie)) {
        displayTitle = englishMovie.replace(wordRegex, '<strong>$1</strong>');
      } else {
        const unnormalizedWord = unnormalizePlural(word);
        const unnormalizedRegex = new RegExp(`\\b(${unnormalizedWord})\\b`, 'i');
        displayTitle = englishMovie.replace(unnormalizedRegex, '<strong>$1</strong>');
      }
    }
    
    const details = selectedMovieList.append('div')
      .attr('class', 'movie-details');

    const titleContainer = details.append('div')
      .attr('class', 'movie-title-container')

    titleContainer.append('p')
      .attr('class', 'movie-title')
      .html(`${displayTitle} <span class="views-text">${viewsInKOrM} views</span>`);
    
    titleContainer.append('p')
      .attr('class', 'toggle-icon')
      .html('+');

    const description = details.append('p')
      .attr('class', 'description')
      .text(d.description);
    
    titleContainer.on('click', () => {
      description.classed('show', !description.classed('show'));
    });
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

// build color scale
const colorScale = d3.scaleLinear()
  .range([colors.scaleLight, colors.scaleMid, colors.scaleDark])

// create tooltip
const tooltip = d3.select("body")
  .append("div")
  .attr("class", "tooltip");

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
}

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

  // Return normalized words that are in topWords
  return words
    .map(word => normalizePlural(word))
    .filter(normalized => topWords.includes(normalized));
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

    // Create an item for each topWord found in the title
    return topWordsInTitle.map(normalized => ({ 
      length: roundedRuntime, 
      word: normalized, 
      views, 
      title, 
      runtime, 
      tconst,
      productionCountries,
      description,
      poster,
    }));
  });

  // roll up by length and word to get average of views 
  // keep individual movie details with TMDB data
  const rolled = d3.rollup(
    items,
    v => ({
      value: Math.round(d3.mean(v, d => d.views)),
      movies: v.map(d => ({ 
        title: d.title, 
        views: d.views, 
        runtime: d.runtime, 
        id: d.tconst,
        productionCountries: d.productionCountries,
        description: d.description,
        poster: d.poster
      }))
    }),
    d => d.length,
    d => d.word
  );

  console.log(rolled)

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

const loadData = async () => {
  const data = await moviesCSV;

  // Step 1: Filter movies that contain topWords (before enrichment)
  const filteredMovies = filterMoviesWithTopWords(data);
  console.log(`Filtered to ${filteredMovies.length} movies (from ${data.length} total) containing topWords`);

  // Step 2: Enrich filtered movies with TMDB data
  d3.select('.selected-movie-list').html('<p class="empty-state">Fetching TMDB data...</p>');
  const enrichedMovies = await enrichMoviesArray(filteredMovies);

  d3.select('.selected-movie-list').html('<p class="empty-state">Hover over cells for more movie details</p>');

  // Step 3: Process enriched data into cells
  let processedData = processData(enrichedMovies);

  // Step 4: Create SVG and scales (after data is ready)
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
    const bracketWidth = 15;
    // bracket opens to the right, starting at the heatmap edge and extending outward
    svg.append("path")
      .attr("d", `M ${xOffset} ${minY} 
                  L ${xOffset + bracketWidth} ${minY} 
                  L ${xOffset + bracketWidth} ${maxY} 
                  L ${xOffset} ${maxY}`)
      .attr("stroke", colors.dark)
      .attr("stroke-width", 2)
      .attr("fill", "none");
    
    // add category label
    const text = svg.append("text")
      .attr("x", xOffset + bracketWidth + 10)
      .attr("y", centerY)
      .attr("text-anchor", "start")
      .style("font-size", "16px")
      .style("font-weight", "bold");
    
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
    .attr("stroke-width", 1.5);

  // helper to filter cells based on value range and show matching movies
  const filterCellsByValue = (hoverValue, tolerance = (maxViews - minViews) * 0.05) => {
    if (hoverValue === null) {
      svg.selectAll('.data-cell').classed('inactive', false).classed('legend-active', false);
      showSelectedMovies(null);
      return;
    }

    // collect all movies from cells in the value range
    const matchingMovies = [];
    
    svg.selectAll('.data-cell').each(function(d) {
      if (!d) return;
      const isInRange = Math.abs(d.value - hoverValue) <= tolerance;
      d3.select(this)
        .classed('legend-active', isInRange)
        .classed('inactive', !isInRange);
      
      // collect ALL movies from active cells (don't filter individual movie.views)
      if (isInRange && d.movies) {
        d.movies.forEach(movie => {
          const isMovieInRange = Math.abs(movie.views - hoverValue) <= tolerance;
          if (isMovieInRange) {
            matchingMovies.push({ ...movie, word: d.word });
          }
        });
      }
    });

    // show the filtered movies
    if (matchingMovies.length > 0) {
      // sort by views descending
      matchingMovies.sort((a, b) => b.views - a.views);
      // dedupe by title
      const uniqueMovies = Array.from(
        new Map(matchingMovies.map(m => [m.title.trim().toLowerCase(), m])).values()
      );
      
      // Use showSelectedMovies helper (pass null for word since we don't highlight a specific word)
      showSelectedMovies(null, uniqueMovies, hoverValue);
    } else {
      showSelectedMovies(null);
    }
  };

  // add interactive overlay to legend for hover detection
  const legendInteractive = legend.append("rect")
    .attr("x", legendX)
    .attr("y", legendY - 10)
    .attr("width", legendWidth)
    .attr("height", legendHeight + 20)
    .style("fill", "transparent")
    .style("cursor", "crosshair")
    .on('mousemove', function(event) {
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
        highlightTick(d.word);
      })
      .on('mouseout', function() {
        resetHighlight();
      })
      .on('click', function(event, d) {
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
        if (!activeSelection) {
          const loadingDiv = tooltip.append("div").attr("class", "loading-tooltip");
          tooltip.style("visibility", "visible");
          tooltip.style("opacity", 1);
          
          // Pick a random movie from this cell
          const randomMovie = d.movies[Math.floor(Math.random() * d.movies.length)];
          
          // Show poster of random movie if available
          if (randomMovie.poster) {
            tooltip.append("img")
              .attr("src", `${posterUrl}${randomMovie.poster}`)
              .attr("alt", randomMovie.title);

            setTimeout(() => {
              loadingDiv.classed('hide-loading', true);
            }, 800);
          } else {
            tooltip.style("opacity", 0.7);
          }

          highlightTick(d.word);

          showSelectedMovies(d.word, d.movies, d.value);
          updateLegendTick(d.value); // show tick on hover
          svg.selectAll('.data-cell').classed('inactive', false).classed('legend-active', false); // clear filtering
        }
      })
      .on("mousemove", function(event) {
        tooltip.style("top", (event.pageY - 10) + "px")
               .style("left", (event.pageX + 10) + "px");
      })
      .on("mouseout", function() {
        resetHighlight();

        if (!activeSelection) {
          showSelectedMovies(null);
          updateLegendTick(null); // hide tick on mouseout if no active selection
          svg.selectAll('.data-cell').classed('inactive', false).classed('legend-active', false); // clear classes

          tooltip.style("visibility", "hidden");
          tooltip.style("opacity", 0);

          tooltip.html(''); // clear tooltip content
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
        }
      })
} 

loadData();