import type { Schema, Struct } from '@strapi/strapi';

export interface AppAddress extends Struct.ComponentSchema {
  collectionName: 'components_app_addresses';
  info: {
    description: '';
    displayName: 'Address';
    icon: 'pinMap';
  };
  attributes: {
    city: Schema.Attribute.Relation<'oneToOne', 'api::city.city'>;
    latitude: Schema.Attribute.Decimal;
    line: Schema.Attribute.String;
    longitude: Schema.Attribute.Decimal;
  };
}

export interface AppAddressDoctor extends Struct.ComponentSchema {
  collectionName: 'components_app_address_doctors';
  info: {
    description: '';
    displayName: 'AddressDoctor';
    icon: 'apps';
  };
  attributes: {
    city: Schema.Attribute.String;
    country: Schema.Attribute.String;
    line: Schema.Attribute.String;
    postcode: Schema.Attribute.String;
  };
}

export interface AppAddressGlobal extends Struct.ComponentSchema {
  collectionName: 'components_app_address_globals';
  info: {
    displayName: 'AddressGlobal';
    icon: 'apps';
  };
  attributes: {
    city: Schema.Attribute.String;
    country: Schema.Attribute.String;
    line: Schema.Attribute.String;
    postcode: Schema.Attribute.String;
  };
}

export interface AppAppointmentsData extends Struct.ComponentSchema {
  collectionName: 'components_app_appointments_data';
  info: {
    description: '';
    displayName: 'appointmentsData';
    icon: 'calendar';
  };
  attributes: {
    daysOff: Schema.Attribute.String;
    duration: Schema.Attribute.Integer;
    endBreak: Schema.Attribute.Time;
    endTime: Schema.Attribute.Time;
    startBreak: Schema.Attribute.Time;
    StartTime: Schema.Attribute.Time;
  };
}

export interface AppCarousel extends Struct.ComponentSchema {
  collectionName: 'components_app_carousels';
  info: {
    displayName: 'carousel';
    icon: 'cast';
  };
  attributes: {
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    title: Schema.Attribute.String;
  };
}

export interface AppDiploma extends Struct.ComponentSchema {
  collectionName: 'components_app_diplomas';
  info: {
    description: '';
    displayName: 'diploma';
    icon: 'file';
  };
  attributes: {
    location: Schema.Attribute.String;
    title: Schema.Attribute.String;
    year: Schema.Attribute.Integer;
  };
}

export interface AppDocuments extends Struct.ComponentSchema {
  collectionName: 'components_app_documents';
  info: {
    displayName: 'Documents';
    icon: 'file';
  };
  attributes: {
    file: Schema.Attribute.Media<'images'>;
    title: Schema.Attribute.String;
  };
}

export interface AppExperience extends Struct.ComponentSchema {
  collectionName: 'components_app_experiences';
  info: {
    displayName: 'experience';
    icon: 'expand';
  };
  attributes: {
    description: Schema.Attribute.Text;
    end: Schema.Attribute.Date;
    start: Schema.Attribute.Date;
    title: Schema.Attribute.String;
  };
}

export interface AppHealthInformations extends Struct.ComponentSchema {
  collectionName: 'components_app_health_informations';
  info: {
    displayName: 'healthInformations';
    icon: 'information';
  };
  attributes: {
    additionalInformations: Schema.Attribute.Text;
    allergies: Schema.Attribute.Text;
    familyHistory: Schema.Attribute.Text;
    hospitalizations: Schema.Attribute.Text;
    pathologies: Schema.Attribute.Text;
    treatments: Schema.Attribute.Text;
  };
}

export interface AppHolidays extends Struct.ComponentSchema {
  collectionName: 'components_app_holidays';
  info: {
    displayName: 'Holidays';
    icon: 'calendar';
  };
  attributes: {
    end: Schema.Attribute.Date;
    start: Schema.Attribute.Date;
  };
}

export interface AppSpeciality extends Struct.ComponentSchema {
  collectionName: 'components_app_specialities';
  info: {
    displayName: 'Speciality';
    icon: 'database';
  };
  attributes: {
    category: Schema.Attribute.Relation<'oneToOne', 'api::category.category'>;
    duration: Schema.Attribute.Integer;
    title: Schema.Attribute.String;
  };
}

export interface AppWorkday extends Struct.ComponentSchema {
  collectionName: 'components_app_workdays';
  info: {
    description: '';
    displayName: 'workday';
    icon: 'apps';
  };
  attributes: {
    address: Schema.Attribute.String;
    city: Schema.Attribute.String;
    duration: Schema.Attribute.Integer;
    endBreak: Schema.Attribute.Time;
    endTime: Schema.Attribute.Time;
    isOff: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    isOnline: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    postcode: Schema.Attribute.String;
    startBreak: Schema.Attribute.Time;
    startTime: Schema.Attribute.Time;
    title: Schema.Attribute.String;
    value: Schema.Attribute.Integer;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    file: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    body: Schema.Attribute.RichText;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaTitle: Schema.Attribute.String & Schema.Attribute.Required;
    shareImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    files: Schema.Attribute.Media<'images', true>;
  };
}

export interface UserAddressUser extends Struct.ComponentSchema {
  collectionName: 'components_user_address_users';
  info: {
    displayName: 'addressUser';
    icon: 'alien';
  };
  attributes: {
    city: Schema.Attribute.String;
    country: Schema.Attribute.String;
    line: Schema.Attribute.String;
    postcode: Schema.Attribute.String;
  };
}

export interface UserHealthRecord extends Struct.ComponentSchema {
  collectionName: 'components_user_health_records';
  info: {
    description: '';
    displayName: 'HealthRecord';
    icon: 'doctor';
  };
  attributes: {
    birthday: Schema.Attribute.Date;
    bloodGroup: Schema.Attribute.Enumeration<
      ['Apos', 'Aneg', 'Bpos', 'Bneg', 'ABpos', 'ABneg', 'Opos', 'Oneg']
    >;
    gender: Schema.Attribute.Enumeration<['man', 'woman']>;
    height: Schema.Attribute.Integer;
    weight: Schema.Attribute.Integer;
  };
}

export interface UserPriceRange extends Struct.ComponentSchema {
  collectionName: 'components_user_price_ranges';
  info: {
    displayName: 'priceRange';
    icon: 'database';
  };
  attributes: {
    maximum: Schema.Attribute.Decimal;
    minimum: Schema.Attribute.Decimal;
  };
}

export interface UserReason extends Struct.ComponentSchema {
  collectionName: 'components_user_reasons';
  info: {
    description: '';
    displayName: 'reason';
    icon: 'apps';
  };
  attributes: {
    description: Schema.Attribute.RichText;
    price: Schema.Attribute.Decimal;
    title: Schema.Attribute.String;
  };
}

export interface UserSomeoneElse extends Struct.ComponentSchema {
  collectionName: 'components_user_someone_elses';
  info: {
    description: '';
    displayName: 'someoneElse';
    icon: 'alien';
  };
  attributes: {
    age: Schema.Attribute.Integer;
    firstname: Schema.Attribute.String;
    gender: Schema.Attribute.Enumeration<['man', 'woman']>;
    lastname: Schema.Attribute.String;
    note: Schema.Attribute.Text;
  };
}

export interface UserUserInformations extends Struct.ComponentSchema {
  collectionName: 'components_user_user_informations';
  info: {
    description: '';
    displayName: 'userInformations';
    icon: 'alien';
  };
  attributes: {
    address: Schema.Attribute.Component<'app.address', false>;
    firstname: Schema.Attribute.String;
    languages: Schema.Attribute.Relation<'oneToMany', 'api::language.language'>;
    lastname: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'app.address': AppAddress;
      'app.address-doctor': AppAddressDoctor;
      'app.address-global': AppAddressGlobal;
      'app.appointments-data': AppAppointmentsData;
      'app.carousel': AppCarousel;
      'app.diploma': AppDiploma;
      'app.documents': AppDocuments;
      'app.experience': AppExperience;
      'app.health-informations': AppHealthInformations;
      'app.holidays': AppHolidays;
      'app.speciality': AppSpeciality;
      'app.workday': AppWorkday;
      'shared.media': SharedMedia;
      'shared.quote': SharedQuote;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slider': SharedSlider;
      'user.address-user': UserAddressUser;
      'user.health-record': UserHealthRecord;
      'user.price-range': UserPriceRange;
      'user.reason': UserReason;
      'user.someone-else': UserSomeoneElse;
      'user.user-informations': UserUserInformations;
    }
  }
}
