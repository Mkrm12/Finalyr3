import nltk
nltk.download('wordnet', force=True)

nltk.download('vader_lexicon')
nltk.download('punkt')


from flask import Flask, request, jsonify
from transformers import BartTokenizer, BartForConditionalGeneration
from nltk.sentiment.vader import SentimentIntensityAnalyzer
from nltk.tokenize import word_tokenize
from nltk.corpus import wordnet
import nltk


app = Flask(__name__)

# Load BART model and tokenizer once
tokenizer = BartTokenizer.from_pretrained("facebook/bart-large-cnn")
model = BartForConditionalGeneration.from_pretrained("facebook/bart-large-cnn")

# Sentiment Analyzer for bias reduction
vader_analyzer = SentimentIntensityAnalyzer()

@app.route('/summarize', methods=['POST'])
def summarize():
    data = request.get_json()
    text = data['text']
    max_length = data.get('max_length', 200)
    min_length = data.get('min_length', 150)

    # Preprocess text
    text = text.replace('\n', ' ').replace('\r', ' ')
    text = ' '.join(text.split())

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

@app.route('/reduce_bias', methods=['POST'])
def reduce_bias():
    data = request.get_json()
    
    if not data or 'text' not in data:
        return jsonify({"error": "Missing 'text' field"}), 400

    text = data['text']
    words = word_tokenize(text)
    neutralized = []

    for word in words:
        score = vader_analyzer.polarity_scores(word)
        
        if abs(score['compound']) > 0.5:
            synsets = wordnet.synsets(word)
            if synsets and len(synsets) > 0:
                lemma = synsets[0].lemma_names()[0].replace('_', ' ')
                neutralized.append(lemma.lower() if lemma.isalpha() else word)
            else:
                neutralized.append(word)
        else:
            neutralized.append(word)

    neutral_text = ' '.join(neutralized)
    return jsonify({"neutral_text": neutral_text})


if __name__ == "__main__":
    app.run(port=5000)