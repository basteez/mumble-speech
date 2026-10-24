/* Minimal example (L4.9): render a line and write it as a WAV file. */
#include <stdio.h>
#include <string.h>

#include "mumble.h"

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "hello.wav";
    const char *text = "Hello from C!";
    MumbleVoice voice = {2 /* alphabet */, 2.0, 15.0, 0.2, 42};

    MumbleRender *render = NULL;
    int32_t rc = mumble_render(text, strlen(text), &voice, 48000, &render);
    if (rc != MUMBLE_OK) {
        fprintf(stderr, "mumble_render failed: %d\n", (int)rc);
        return 1;
    }
    size_t count = 0;
    const float *samples = mumble_render_samples(render, &count);

    uint8_t *wav = NULL;
    size_t wav_len = 0;
    rc = mumble_encode_wav(samples, count, 48000, &wav, &wav_len);
    mumble_render_free(render);
    if (rc != MUMBLE_OK) return 1;

    FILE *f = fopen(path, "wb");
    if (!f || fwrite(wav, 1, wav_len, f) != wav_len) {
        fprintf(stderr, "cannot write %s\n", path);
        mumble_bytes_free(wav, wav_len);
        return 1;
    }
    fclose(f);
    mumble_bytes_free(wav, wav_len);
    printf("wrote %s (%zu samples)\n", path, count);
    return 0;
}
