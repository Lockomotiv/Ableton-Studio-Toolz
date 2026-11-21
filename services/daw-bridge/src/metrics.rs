//! Ringpuffer für tatsächlich gemessene OSC-Laufzeiten.
//! Es werden ausschließlich Werte aufgenommen, die mit `Instant` um einen
//! echten UDP-Roundtrip herum gemessen wurden.

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;

const CAPACITY: usize = 500;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub at_ms: u64,
    pub address: String,
    pub roundtrip_ms: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSummary {
    pub count: usize,
    pub min_ms: Option<f64>,
    pub avg_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub timeouts: u64,
    pub recent: Vec<Sample>,
}

#[derive(Default)]
pub struct OscMetrics {
    samples: Mutex<VecDeque<Sample>>,
    timeouts: Mutex<u64>,
}

impl OscMetrics {
    pub fn record(&self, address: &str, roundtrip_ms: f64) {
        let mut s = self.samples.lock().unwrap();
        if s.len() == CAPACITY {
            s.pop_front();
        }
        s.push_back(Sample {
            at_ms: crate::types::now_ms(),
            address: address.to_string(),
            roundtrip_ms,
        });
    }

    pub fn record_timeout(&self) {
        *self.timeouts.lock().unwrap() += 1;
    }

    pub fn summary(&self) -> MetricsSummary {
        let s = self.samples.lock().unwrap();
        let timeouts = *self.timeouts.lock().unwrap();
        summarize(s.iter().cloned().collect(), timeouts)
    }
}

pub fn summarize(samples: Vec<Sample>, timeouts: u64) -> MetricsSummary {
    if samples.is_empty() {
        return MetricsSummary { timeouts, ..Default::default() };
    }
    let mut v: Vec<f64> = samples.iter().map(|x| x.roundtrip_ms).collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    let p95_idx = ((n as f64 * 0.95).ceil() as usize).saturating_sub(1).min(n - 1);
    let recent = samples.iter().rev().take(20).cloned().collect();
    MetricsSummary {
        count: n,
        min_ms: Some(v[0]),
        avg_ms: Some(v.iter().sum::<f64>() / n as f64),
        p95_ms: Some(v[p95_idx]),
        max_ms: Some(v[n - 1]),
        timeouts,
        recent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_of_known_values() {
        let m = OscMetrics::default();
        for i in 1..=20 {
            m.record("/x", i as f64);
        }
        m.record_timeout();
        let s = m.summary();
        assert_eq!(s.count, 20);
        assert_eq!(s.min_ms, Some(1.0));
        assert_eq!(s.max_ms, Some(20.0));
        assert_eq!(s.avg_ms, Some(10.5));
        assert_eq!(s.p95_ms, Some(19.0));
        assert_eq!(s.timeouts, 1);
    }

    #[test]
    fn empty_summary_has_no_fake_numbers() {
        let s = OscMetrics::default().summary();
        assert_eq!(s.count, 0);
        assert!(s.avg_ms.is_none());
    }
}
