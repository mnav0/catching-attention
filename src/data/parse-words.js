var wordCounts = { };
var titleLengths = { };
var movieLengths = {};

// includes some plurals
const additives = ['the', 'and', 'of', 'or', 'la', 'el', 'a', 'in', 'to', 'for', 'with', 'de', 'tamil', 'on', 'ii', 'at', 'hindi', 'is', 'after', 'from', 'telugu', 'up', 'girls', 'boys', 'days', 'men'];

// for movies - people usually click once and watch
d3.csv("./NetflixMovies_added.csv").then(data => {
  const sortedData = data.sort((a, b) => b["Views"] - a["Views"]);
  const movieLengths = {};

  sortedData.forEach((row) => {
    parseTitles(row["Title"]);
  });
  const top50Words = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 55);
  const flattenedWords = top50Words.map(entry => entry[0]);
  sortedData.forEach((row) => {
    var words = row["Title"].split(" ").map(word => word.toLowerCase().replace(/[^a-zA-Z]/g, ''));

    if (words.length && words.length <= 5) {
      if (words.some(word => flattenedWords.includes(word))) {
        movieLengths[row["Title"]] = getMovieLengthInMinutes(row["Runtime"]);
      }
    }
  });

  const sortedLengths = Object.entries(movieLengths).sort((a, b) => b[1] - a[1]);

  console.log(top50Words);
  console.log(sortedLengths);
});

const getMovieLengthInMinutes = (runtime) => {
  const numbers = runtime.split(":");
  const hours = parseInt(numbers[0]);
  const minutes = parseInt(numbers[1]);
  const totalMinutes = (hours * 60) + minutes;
  return totalMinutes;
}

const parseTitles = (text) => {
  const length = countTitleLengths(text);

  if (length <= 5) {
    countWords(text);
  }
}

const countTitleLengths = (text) => {
  return text.split(" ").length;
}

const countWords = (text) => {
  const englishWords = text.split("//")[0]; // in case of multiple languages, only take first
  var words = englishWords.split(" ")
    .map(word => word.toLowerCase().replace(/[^a-zA-Z]/g, ''))
    .filter(word => {
      return word.length > 0 && !additives.includes(word)
    });

  for(var i = 0; i < words.length; i++)
    if (wordCounts[words[i]]) {
      wordCounts[words[i]] += 1;
    } else {
      wordCounts[words[i]] = 1;
    }
}