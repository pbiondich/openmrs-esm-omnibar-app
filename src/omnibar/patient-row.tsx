import React, { useMemo } from 'react';
import GeoPattern from 'geopattern';
import { Tag } from '@carbon/react';
import {
  age,
  formatPartialDate,
  GenderFemaleIcon,
  GenderMaleIcon,
  GenderOtherIcon,
  GenderUnknownIcon,
  getCoreTranslation,
  useConfig,
  usePrimaryIdentifierCode,
} from '@openmrs/esm-framework';
import { usePatientPhotoUrl } from './patient-photo';
import { type OmnibarPatient } from './types';
import styles from './patient-row.scss';

/**
 * A patient laid out as the patient search app's compact result does it: PatientPhoto's avatar, then
 * PatientBannerPatientInfo's name, gender, age, birthdate and identifiers. Both are redrawn here.
 * PatientPhoto loads an image from a path the server supplies, which a crafted path can send to
 * another site; the photo here comes only from this origin (see patient-photo.ts). PatientBannerPatientInfo
 * mounts two extension slots, which would put other apps' extensions inside every option. The avatar and
 * icons are decoration, since the text names the patient.
 */

const genders: Record<string, { key: 'male' | 'female' | 'other' | 'unknown'; Icon: typeof GenderUnknownIcon }> = {
  M: { key: 'male', Icon: GenderMaleIcon },
  F: { key: 'female', Icon: GenderFemaleIcon },
  O: { key: 'other', Icon: GenderOtherIcon },
  U: { key: 'unknown', Icon: GenderUnknownIcon },
};

// As PatientPhoto makes them: the first letter of up to three words of the name.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join('');
}

export const PatientRow: React.FC<{ name: string; patient: OmnibarPatient; note?: string }> = ({
  name,
  patient,
  note,
}) => {
  // Seeded from the uuid, as PatientPhoto does, so each patient keeps their pattern.
  const pattern = useMemo(() => GeoPattern.generate(patient.uuid).toDataUrl(), [patient.uuid]);
  const { photoUrl, forgetPhoto } = usePatientPhotoUrl(patient.uuid);
  const gender = patient.gender ? genders[patient.gender] : undefined;
  const GenderIcon = gender?.Icon ?? GenderUnknownIcon;
  const identifiers = useShownIdentifiers(patient.identifiers ?? []);

  // PatientBannerPatientInfo's line: age · birthdate · identifiers, with the note last.
  const demographics: Array<[string, React.ReactNode]> = [];
  if (patient.birthdate) {
    demographics.push(['age', age(patient.birthdate)]);
    demographics.push(['birthdate', formatPartialDate(patient.birthdate, { time: false })]);
  }
  for (const { identifier, typeName, primary } of identifiers) {
    const label = typeName && <span dir="auto">{typeName}: </span>;
    demographics.push([
      `identifier-${identifier}`,
      // The primary identifier sits in a tag, as PatientBannerPatientIdentifiers shows it.
      primary ? (
        <span className={styles.primaryIdentifier}>
          <Tag className={styles.tag} type="gray">
            {label}
            <span className={styles.identifierValue} dir="auto">
              {identifier}
            </span>
          </Tag>
        </span>
      ) : (
        <span className={styles.secondaryIdentifier}>
          {label}
          <span dir="auto">{identifier}</span>
        </span>
      ),
    ]);
  }
  if (note) {
    demographics.push(['note', <span dir="auto">{note}</span>]);
  }

  return (
    <>
      <div className={styles.avatar} style={{ backgroundImage: pattern }} aria-hidden data-testid="patientAvatar">
        <span className={styles.initials}>{initials(name)}</span>
        {/* Over the tile, which shows until the photo loads and comes back if it fails to. */}
        {photoUrl && <img className={styles.photo} src={photoUrl} alt="" loading="lazy" onError={forgetPhoto} />}
      </div>{' '}
      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.name} dir="auto">
            {name}
          </span>{' '}
          {patient.gender && (
            <span className={styles.gender}>
              <span aria-hidden className={styles.genderIcon}>
                <GenderIcon fill="#525252" />
              </span>
              <span>{gender ? getCoreTranslation(gender.key) : patient.gender}</span>
            </span>
          )}
        </div>{' '}
        <div className={styles.demographics}>
          {demographics.map(([key, part], index) => (
            <React.Fragment key={key}>
              {index > 0 && (
                <>
                  {' '}
                  <span className={styles.separator}>&middot;</span>{' '}
                </>
              )}
              <span>{part}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </>
  );
};

// PatientBannerPatientIdentifiers' rules: identifiers without a type are left out, as are the types the
// styleguide config excludes, and the primary identifier type comes from the metadata mapping.
function useShownIdentifiers(identifiers: NonNullable<OmnibarPatient['identifiers']>) {
  const { excludePatientIdentifierCodeTypes } = useConfig<{ excludePatientIdentifierCodeTypes?: { uuids: string[] } }>({
    externalModuleName: '@openmrs/esm-styleguide',
  });
  const { primaryIdentifierCode } = usePrimaryIdentifierCode();
  return identifiers
    .filter(({ typeUuid }) => typeUuid && !excludePatientIdentifierCodeTypes?.uuids.includes(typeUuid))
    .map((identifier) => ({ ...identifier, primary: identifier.typeUuid === primaryIdentifierCode }));
}
