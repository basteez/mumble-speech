//! The only source of randomness of the core (R3.8).

/// 32-bit FNV-1a hash over bytes.
pub fn fnv1a(input: &[u8]) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for &byte in input {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

/// Mulberry32 PRNG, values in [0, 1). Same sequence as the original TypeScript version.
#[derive(Clone, Debug)]
pub struct Mulberry32(u32);

impl Mulberry32 {
    pub const fn new(seed: u32) -> Mulberry32 {
        Mulberry32(seed)
    }

    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_matches_reference_values() {
        assert_eq!(fnv1a(b""), 0x811c_9dc5);
        assert_eq!(fnv1a(b"a"), 0xe40c_292c);
        assert_eq!(fnv1a(b"foobar"), 0xbf9c_f968);
    }

    #[test]
    fn mulberry32_matches_the_typescript_sequence() {
        let mut rng = Mulberry32::new(0);
        assert_eq!(rng.next_f64(), 0.266_429_208_684_712_65);
        assert_eq!(rng.next_f64(), 0.000_329_745_700_582_861_9);
        assert_eq!(rng.next_f64(), 0.223_272_027_447_819_7);
    }

    #[test]
    fn mulberry32_stays_in_unit_interval() {
        let mut rng = Mulberry32::new(7);
        for _ in 0..10_000 {
            let x = rng.next_f64();
            assert!((0.0..1.0).contains(&x));
        }
    }
}
