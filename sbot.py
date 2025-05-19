from flask import Flask, request, jsonify, Response, stream_with_context
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

wordnet.ensure_loaded()            

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

        if data.get("rewrite", False):
            text = "Rewrite the following text in your own concise words and summarize it: " + text

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
        full_summary = tokenizer.decode(summary_ids[0], skip_special_tokens=True).strip()

        def generate_chunks():
            chunk_size = 50  
            for i in range(0, len(full_summary), chunk_size):
                yield full_summary[i:i+chunk_size]
        return Response(stream_with_context(generate_chunks()), mimetype='text/plain')
    except KeyError:
        return jsonify({"error": "Missing 'text' field in JSON data."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/reduce_bias', methods=['POST'])
def reduce_bias():
    try:
        data = request.get_json()
        text = data['text']

        sentences = re.split(r'(?<=[.^!?])\s*', text)
        neutral_sentences = []
        for sentence in sentences:
            sentence_score = vader_analyzer.polarity_scores(sentence)
            if abs(sentence_score['compound']) > 0.3:  
                words = word_tokenize(sentence)
                neutralized = []
                for word in words:
                    score = vader_analyzer.polarity_scores(word)
                    if abs(score['compound']) > 0.5:
                        synsets = wordnet.synsets(word)
                        if synsets:
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

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        text = data.get('message', '')

        if not text:
            return jsonify({"error": "No topic provided."}), 400

        # Step 1: Reduce bias
        bias_response = reduce_bias()
        bias_data = bias_response.get_json()
        neutral_text = bias_data.get("neutral_text", text)

        # Step 2: Summarize unbiased text
        summary_response = summarize()
        summary_text = summary_response.get_data(as_text=True)

        return jsonify({"summary": summary_text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
