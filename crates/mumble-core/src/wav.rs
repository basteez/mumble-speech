use alloc::vec::Vec;

/// Encodes mono samples as a 16-bit PCM WAV file (R7.1, L2.4). Out-of-range samples are clamped.
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_size = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_size).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_size.to_le_bytes());
    for &x in samples {
        let x = f64::from(x.clamp(-1.0, 1.0));
        let pcm = if x < 0.0 { x * 32768.0 } else { x * 32767.0 } as i16;
        out.extend_from_slice(&pcm.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u32_at(b: &[u8], i: usize) -> u32 {
        u32::from_le_bytes(b[i..i + 4].try_into().unwrap())
    }
    fn u16_at(b: &[u8], i: usize) -> u16 {
        u16::from_le_bytes(b[i..i + 2].try_into().unwrap())
    }

    #[test]
    fn writes_a_16_bit_mono_pcm_header() {
        let samples = [0.0, 0.5, -0.5, 1.0, -1.0, 2.0, -2.0];
        let wav = encode_wav(&samples, 44_100);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(u32_at(&wav, 4), 36 + 14);
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(u32_at(&wav, 16), 16);
        assert_eq!(u16_at(&wav, 20), 1);
        assert_eq!(u16_at(&wav, 22), 1);
        assert_eq!(u32_at(&wav, 24), 44_100);
        assert_eq!(u32_at(&wav, 28), 88_200);
        assert_eq!(u16_at(&wav, 32), 2);
        assert_eq!(u16_at(&wav, 34), 16);
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32_at(&wav, 40), 14);
        assert_eq!(wav.len(), 44 + 14);
    }

    #[test]
    fn converts_and_clamps_samples() {
        let wav = encode_wav(&[0.0, 0.5, -0.5, 1.0, -1.0, 2.0, -2.0], 44_100);
        let pcm: Vec<i16> = wav[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(pcm, [0, 16383, -16384, 32767, -32768, 32767, -32768]);
    }

    #[test]
    fn round_trips_within_one_lsb() {
        let input: Vec<f32> = (0..1000).map(|i| (libm::sin(f64::from(i) / 10.0) * 0.9) as f32).collect();
        let wav = encode_wav(&input, 44_100);
        for (x, c) in input.iter().zip(wav[44..].chunks(2)) {
            let s = f64::from(i16::from_le_bytes([c[0], c[1]]));
            let decoded = if s < 0.0 { s / 32768.0 } else { s / 32767.0 };
            assert!(libm::fabs(decoded - f64::from(*x)) <= 1.0 / 32767.0);
        }
    }
}
