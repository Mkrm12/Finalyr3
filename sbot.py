from flask import Flask, request, jsonify
from transformers import BartTokenizer, BartForConditionalGeneration
from nltk.sentiment.vader import SentimentIntensityAnalyzer
from nltk.tokenize import word_tokenize
from nltk.corpus import wordnet
import nltk
import re

# Download required NLTK resources
nltk.download('vader_lexicon')
nltk.download('punkt')
nltk.download('wordnet')

app = Flask(__name__)

# Use a distilled version of BART for faster processing
tokenizer = BartTokenizer.from_pretrained("sshleifer/distilbart-cnn-12-6")
model = BartForConditionalGeneration.from_pretrained("sshleifer/distilbart-cnn-12-6")

# Sentiment Analyzer for bias detection
vader_analyzer = SentimentIntensityAnalyzer()

@app.route('/summarize', methods=['POST'])
def summarize():
    try:
        data = request.get_json()
        text = data['text']
        max_length = data.get('max_length', 200)
        min_length = data.get('min_length', 150)

        # Text preprocessing
        text = re.sub(r'\s+', ' ', text).strip()

        inputs = tokenizer([text], max_length=512, return_tensors="pt", truncation=True)
        summary_ids = model.generate(
            inputs["input_ids"],
            max_length=max_length,
            min_length=min_length,
            num_beams=4,
            length_penalty=2.0,
            no_repeat_ngram_size=3,
            early_stopping=True
        )
        summary = tokenizer.decode(summary_ids[0], skip_special_tokens=True)
        return jsonify({"summary": summary.strip()})
    except KeyError:
        return jsonify({"error": "Missing 'text' field in JSON data."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/reduce_bias', methods=['POST'])
def reduce_bias():
    try:
        data = request.get_json()
        text = data['text']

        # Split text into sentences for better context
        sentences = re.split(r'(?<=[.^!?])\s*', text)
        neutral_sentences = []

        for sentence in sentences:
            # Analyze sentiment of the entire sentence
            sentence_score = vader_analyzer.polarity_scores(sentence)
            if abs(sentence_score['compound']) > 0.3:  # Adjust threshold as needed
                # Tokenize sentence into words
                words = word_tokenize(sentence)
                neutralized = []

                for word in words:
                    score = vader_analyzer.polarity_scores(word)
                    if abs(score['compound']) > 0.5:
                        synsets = wordnet.synsets(word)
                        if synsets:
                            # Replace with a more neutral synonym if available
                            lemma = synsets[0].lemmas()[0].name().replace('_', ' ')
                            neutralized.append(lemma.lower() if lemma.isalpha() else word)
                        else:
                            neutralized.append(word)
                    else:
                        neutralized.append(word)

                neutral_sentence = ' '.join(neutralized)
                neutral_sentences.append(neutral_sentence)
            else:
                neutral_sentences.append(sentence)

        neutral_text = ' '.join(neutral_sentences)
        return jsonify({"neutral_text": neutral_text})
    except KeyError:
        return jsonify({"error": "Missing 'text' field in JSON data."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(port=5000)