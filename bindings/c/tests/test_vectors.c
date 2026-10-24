/* Runs every conformance vector through the C ABI (L4.3, L4.4, L5.2). */
#include <stdio.h>
#include <string.h>

#include "mumble.h"
#include "vectors.h"

static int failures = 0;

#define CHECK(cond, ...)                         \
    do {                                         \
        if (!(cond)) {                           \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__); \
            fprintf(stderr, __VA_ARGS__);        \
            fputc('\n', stderr);                 \
            failures++;                          \
        }                                        \
    } while (0)

/* 64-bit FNV-1a over the little-endian bytes of the samples (LD7). */
static uint64_t pcm_hash(const float *samples, size_t count) {
    const unsigned char *bytes = (const unsigned char *)samples;
    uint64_t hash = UINT64_C(0xcbf29ce484222325);
    for (size_t i = 0; i < count * sizeof(float); i++) {
        hash ^= bytes[i];
        hash *= UINT64_C(0x100000001b3);
    }
    return hash;
}

static void check_vector(const MumbleVector *v) {
    MumbleVoice voice = {v->style, v->pitch, v->speed, v->variation, v->seed};
    MumbleRender *render = NULL;
    int32_t rc = mumble_render(v->text, v->text_len, &voice, v->sample_rate, &render);
    if (v->error != 0) {
        CHECK(rc == v->error, "%s: expected error %d, got %d", v->id, (int)v->error, (int)rc);
        CHECK(render == NULL, "%s: render must stay NULL on error", v->id);
        return;
    }
    CHECK(rc == MUMBLE_OK, "%s: render failed with %d", v->id, (int)rc);
    if (rc != MUMBLE_OK) return;

    size_t count = 0;
    const float *samples = mumble_render_samples(render, &count);
    CHECK(count == v->sample_count, "%s: %zu samples, expected %zu", v->id, count, v->sample_count);
    CHECK(pcm_hash(samples, count) == v->pcm_hash, "%s: PCM hash mismatch", v->id);
    CHECK(mumble_render_event_count(render) == v->event_count, "%s: event count", v->id);

    /* Speaker fed the whole text at once places sounds exactly like render (L3.2, L3.3). */
    MumbleSpeaker *speaker = NULL;
    CHECK(mumble_speaker_new(&voice, v->sample_rate, &speaker) == MUMBLE_OK, "%s: speaker", v->id);
    MumbleUtterance u;
    CHECK(mumble_speaker_next(speaker, v->text, v->text_len, &u) == MUMBLE_OK, "%s: next", v->id);
    CHECK(u.sample_count <= count, "%s: speaker longer than render", v->id);
    if (u.sample_count <= count) {
        CHECK(u.sample_count == 0 || memcmp(u.samples, samples, u.sample_count * sizeof(float)) == 0,
              "%s: speaker samples differ from render", v->id);
        for (size_t i = u.sample_count; i < count; i++) {
            if (samples[i] != 0.0f) {
                CHECK(0, "%s: render tail is not silent", v->id);
                break;
            }
        }
    }
    CHECK(u.has_dot == (v->event_count > 0), "%s: has_dot", v->id);
    mumble_speaker_free(speaker);
    mumble_render_free(render);
}

static void check_errors(void) {
    MumbleVoice voice = {0, 0.0, 15.0, 0.0, 0};
    MumbleRender *render = NULL;
    CHECK(mumble_abi_version() == MUMBLE_ABI_VERSION, "ABI version");
    CHECK(mumble_render("a", 1, &voice, 48000, NULL) == MUMBLE_ERR_NULL, "null out");
    CHECK(mumble_render(NULL, 1, &voice, 48000, &render) == MUMBLE_ERR_NULL, "null text");
    CHECK(mumble_render("a", 1, NULL, 48000, &render) == MUMBLE_ERR_NULL, "null voice");
    CHECK(mumble_render("\xff", 1, &voice, 48000, &render) == MUMBLE_ERR_UTF8, "invalid UTF-8");
    MumbleVoice bad_style = {7, 0.0, 15.0, 0.0, 0};
    CHECK(mumble_render("a", 1, &bad_style, 48000, &render) == MUMBLE_ERR_VOICE, "unknown style");
    CHECK(render == NULL, "render untouched on error");

    CHECK(mumble_render(NULL, 0, &voice, 48000, &render) == MUMBLE_OK, "empty text with NULL pointer");
    MumbleEvent event;
    CHECK(mumble_render_event(render, 0, &event) == MUMBLE_ERR_INDEX, "event index out of range");
    mumble_render_free(render);

    CHECK(mumble_render("Hi", 2, &voice, 48000, &render) == MUMBLE_OK, "render Hi");
    CHECK(mumble_render_event(render, 1, &event) == MUMBLE_OK && event.utf8_start == 1, "second event");
    CHECK(mumble_render_duration(render) > 0.0, "duration");
    mumble_render_free(render);

    MumbleSpeaker *speaker = NULL;
    CHECK(mumble_speaker_new(&voice, 7999, &speaker) == MUMBLE_ERR_SAMPLE_RATE, "speaker sample rate");
    CHECK(mumble_speaker_new(&voice, 48000, &speaker) == MUMBLE_OK, "speaker");
    MumbleUtterance u;
    CHECK(mumble_speaker_next(speaker, ".", 1, &u) == MUMBLE_OK && u.sample_count == 0 && !u.has_dot, "pause");
    mumble_speaker_reset(speaker);
    mumble_speaker_free(speaker);

    float pcm[3] = {0.0f, 0.5f, -0.5f};
    uint8_t *wav = NULL;
    size_t wav_len = 0;
    CHECK(mumble_encode_wav(pcm, 3, 44100, &wav, &wav_len) == MUMBLE_OK, "encode wav");
    CHECK(wav_len == 44 + 6 && memcmp(wav, "RIFF", 4) == 0, "wav header");
    mumble_bytes_free(wav, wav_len);

    mumble_render_free(NULL);
    mumble_speaker_free(NULL);
    mumble_bytes_free(NULL, 0);
}

int main(void) {
    for (size_t i = 0; i < MUMBLE_VECTOR_COUNT; i++) check_vector(&MUMBLE_VECTORS[i]);
    check_errors();
    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("%d vectors and error cases passed\n", MUMBLE_VECTOR_COUNT);
    return 0;
}
