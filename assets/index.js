import { topWords, wordCategories } from './constants/words.js';
import { colors } from './constants/colors.js';

// set the dimensions and margins of the heatmap
const margin = {top: 50, right: 640, bottom: 250, left: 100},
  width = 1275 - margin.left - margin.right,
  height = 1700 - margin.top - margin.bottom;

// column labels = runtimes (in minutes)
const runtimes = d3.range(20, 200, 10);

// create and append svg object to page
const svg = d3.select("#heatmap")
  .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
  .append("g")
    .attr("transform",
          "translate(" + margin.left + "," + margin.top + ")");

// x scale
const x = d3.scaleBand()
  .range([ 0, width ])
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
const y = d3.scaleBand()
  .range([ 0, height ])
  .domain(topWords)
  .padding(0.01);

// add y-axis labels on the left
const yAxisG = svg.append("g")
  .attr("class", "y-axis")
  .attr("transform", `translate(-5, 0)`) // left side
  .call(d3.axisLeft(y).tickSize(0))
  .call(g => g.select(".domain").remove())
  // set default tick text styles so we can animate to the active state
  .call(g => g.selectAll('.tick text').style('font-size', '12px').style('font-weight', 'normal'));

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
  yAxisG.selectAll('.tick').select('text')
    .transition()
    .duration(100)
    .style('font-size', '12px')
    .style('font-weight', 'normal');
}

const showSelectedMovies = (word, movies) => {
  const selectedMovieList = d3.select('.selected-movie-list');
  const emptyState = selectedMovieList.select('.empty-state');
  if (word === null) {
    selectedMovieList.html('');
    emptyState.html('Hover over cells for more movie details');
    selectedMovieList.append(() => emptyState.node());
  } else {
    emptyState.html('Titles');

    // create a p tag for each movie containing this word
    movies.forEach(d => {
      const englishMovie = d.title.split("//")[0];
      // bold the word, only if it isn't inside of another word
      const boldedWordTitle = englishMovie.replace(new RegExp(`\\b(${word})\\b`, 'i'), '<strong>$1</strong>');
      const viewsInKOrM = d.views >= 1000000 ? `${(d.views / 1000000).toFixed(1)}m` : `${(d.views / 1000).toFixed(0)}k`;
      selectedMovieList.append('p')
        .attr('class', 'movie-title')
        .html(`${boldedWordTitle} <span class="views-text">${viewsInKOrM} views</span>`); // in case of multiple languages, only take english translation
    });
  }
}

// add word category labels and brackets on the right
// position these just outside the right edge of the heatmap
const categoryAxisOffset = width - 5;
const categorySpacing = 5;

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
          const rangesOverlap = !(maxY < existing.minY || minY > existing.maxY);
          
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
    
    levels.push({ category, minY, maxY, level });
  }
  
  return levels;
};

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

// build color scale
const colorScale = d3.scaleLinear()
  .range([colors.scaleLight, colors.scaleMid, colors.scaleDark])

// create tooltip
const tooltip = d3.select("body")
  .append("div")
  .style("position", "absolute")
  .style("visibility", "hidden")
  .style("background-color", "white")
  .style("border", `1px solid ${colors.light}`)
  .style("border-radius", "5px")
  .style("padding", "10px")
  .style("font-size", "12px")
  .style("max-width", "300px")
  .style("z-index", "1000");

// read movie data
d3.csv("assets/data/Movies-Table.csv").then(data => {
  const processedData = processData(data);

  // update color scale domain based on actual data
  const minValue = d3.min(processedData, d => d.value);
  const maxValue = d3.max(processedData, d => d.value);
  const midValue = (minValue + maxValue) / 2;
  colorScale.domain([minValue, midValue, maxValue]);

  // add color legend
  const legendWidth = 350;
  const legendHeight = 10;
  const legendX = width - legendWidth + 540;
  const legendY = 0;

  // create gradient for legend
  const defs = svg.append("defs");
  const linearGradient = defs.append("linearGradient")
    .attr("id", "legend-gradient");

  linearGradient.append("stop")
    .attr("offset", "0%")
    .attr("stop-color", colorScale(minValue));

  linearGradient.append("stop")
    .attr("offset", "50%")
    .attr("stop-color", colorScale(midValue));

  linearGradient.append("stop")
    .attr("offset", "100%")
    .attr("stop-color", colorScale(maxValue));

  // draw legend rectangle
  svg.append("rect")
    .attr("x", legendX)
    .attr("y", legendY)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("fill", "url(#legend-gradient)");

  // min label
  svg.append("text")
    .attr("x", legendX + legendWidth / 2 - 20)
    .attr("y", -20)
    .attr("text-anchor", "start")
    .style("font-size", "12px")
    .text("Views");
  // min label
  svg.append("text")
    .attr("x", legendX)
    .attr("y", legendY + legendHeight + 15)
    .attr("text-anchor", "start")
    .style("font-size", "12px")
    .text(minValue.toLocaleString());

  // max label
  svg.append("text")
    .attr("x", legendX + legendWidth)
    .attr("y", legendY + legendHeight + 15)
    .attr("text-anchor", "end")
    .style("font-size", "12px")
    .text(maxValue.toLocaleString());

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
      .style("stroke", colors.light)
      .style("stroke-width", 0.5);
  
    // highlight corresponding y label when hovering a grid row
    svg.selectAll('.grid-cell')
      .on('mouseover', function(event, d) {
        highlightTick(d.word);
      })
      .on('mouseout', function() {
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
        tooltip.style("visibility", "visible");
        highlightTick(d.word);
        let tooltipContent = `<strong>${d.word}</strong> (${d.length} min)<br/><br/>`;
        tooltipContent += `${d.value.toLocaleString()} views<br/>`;
        tooltipContent += `${d.movies.length} movie${d.movies.length !== 1 ? 's' : ''}`;
        tooltip.html(tooltipContent);
        showSelectedMovies(d.word, d.movies);
      })
      .on("mousemove", function(event) {
        tooltip.style("top", (event.pageY - 10) + "px")
               .style("left", (event.pageX + 10) + "px");
      })
      .on("mouseout", function() {
        tooltip.style("visibility", "hidden");
        resetHighlight();
        showSelectedMovies(null);
      });
})

// normalize words to their singular form
const normalizePlural = (word) => {
  let normalizedWord = word;

  if (word == 'men') {
    normalizedWord = 'man';
  }

  if (word == 'women') {
    normalizedWord = 'woman';
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

// process the data based on the titles, runtime, and views into tuples 
// (word in title, runtime in mins rounded to 10, views)
// only count movies that contain the words in the topWords list
// if there are 2+ data points with the same (word, runtime) pair, average the views
const processData = (data) => {
  // flatten rows into individual (length, word, views, title) items for words in topWords
  const items = data.flatMap(row => {
    const englishWords = (row["Title"] || "").split("//")[0]; // in case of multiple languages, only take english translation
    const words = englishWords
      .split(" ")
      .map(w => w.toLowerCase().replace(/[^a-zA-Z]/g, ''))
      .filter(w => w.length > 0);

    if (!words.length || words.length > 5) return [];

    const runtime = getMovieLengthInMinutes(row["Runtime"]);
    const roundedRuntime = Math.round(runtime / 10) * 10;
    // remove commas from the Views string before parsing
    const views = parseInt(row["Views"].replace(/,/g, ''));
    const title = row["Title"];

    return words
      .map(word => ({ normalized: normalizePlural(word) }))
      .filter(({ normalized }) => topWords.includes(normalized))
      .map(({ normalized }) => ({ length: roundedRuntime, word: normalized, views, title, runtime }));
  });

  // roll up by length and word to get average of views 
  // keep individual movie details for tooltip
  const rolled = d3.rollup(
    items,
    v => ({
      value: Math.round(d3.mean(v, d => d.views)),
      movies: v.map(d => ({ title: d.title, views: d.views, runtime: d.runtime }))
    }),
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
